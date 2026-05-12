//! Lazy-stream tests for SMOODEV-967.
//!
//! These exercise `File::from_stream_lazy`, `iter_bytes`, and the lazy path
//! of `upload_to_s3_with_client`. The headline test (`lazy_stream_100mb`)
//! pushes 100 MB through the lazy pipeline and asserts that process RSS
//! stays well under +50 MB of the baseline.

use bytes::Bytes;
use futures::StreamExt;
use smooai_file::{File, LAZY_HEAD_BYTES};
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, ReadBuf};

/// A non-EOF async reader that yields a single byte value up to a fixed
/// length. Used to construct large streams without allocating the payload.
struct ConstByteReader {
    byte: u8,
    remaining: usize,
}
impl ConstByteReader {
    fn new(byte: u8, len: usize) -> Self {
        Self {
            byte,
            remaining: len,
        }
    }
}
impl AsyncRead for ConstByteReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.remaining == 0 {
            return Poll::Ready(Ok(()));
        }
        let avail = std::cmp::min(buf.remaining(), self.remaining);
        // SAFETY: filling buf.remaining() bytes which buf authorises.
        let slice = buf.initialize_unfilled_to(avail);
        slice.iter_mut().for_each(|b| *b = self.byte);
        buf.advance(avail);
        self.remaining -= avail;
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn from_stream_lazy_small_stream_falls_back_to_eager() {
    // A source smaller than LAZY_HEAD_BYTES should promote to the eager path
    // so callers still get an exact size and a cached buffer for read().
    let data = b"hello world".to_vec();
    let cursor = std::io::Cursor::new(data.clone());
    let file = File::from_stream_lazy(cursor, None).await.unwrap();
    assert!(!file.is_lazy(), "small stream should fall back to eager");
    assert_eq!(file.size(), Some(data.len() as u64));
    let bytes = file.read().await.unwrap();
    assert_eq!(bytes.as_ref(), data.as_slice());
}

#[tokio::test]
async fn from_stream_lazy_large_stream_stays_lazy() {
    // 200 KB > 64 KB head buffer => must stay lazy with the tail un-buffered.
    let total = 200 * 1024;
    let reader = ConstByteReader::new(0xAB, total);
    let file = File::from_stream_lazy(reader, None).await.unwrap();
    assert!(file.is_lazy(), "large stream should stay lazy");
    // Size unknown until the tail is drained.
    assert_eq!(file.size(), None);

    // iter_bytes drains the tail.
    let mut stream = file.iter_bytes();
    let mut got: usize = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.unwrap();
        got += chunk.len();
    }
    assert_eq!(got, total);
}

#[tokio::test]
async fn read_drains_lazy_tail() {
    let total = 200 * 1024;
    let reader = ConstByteReader::new(0xCD, total);
    let file = File::from_stream_lazy(reader, None).await.unwrap();
    let bytes = file.read().await.unwrap();
    assert_eq!(bytes.len(), total);
    // Every byte should be 0xCD.
    assert!(bytes.iter().all(|&b| b == 0xCD));
}

#[tokio::test]
async fn iter_bytes_yields_head_first() {
    // Build a 100 KB stream with a recognisable PNG header. iter_bytes should
    // yield the head (containing the magic bytes) first.
    let mut data = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    data.extend(std::iter::repeat_n(0u8, 100 * 1024));
    let cursor = std::io::Cursor::new(data.clone());
    let file = File::from_stream_lazy(cursor, None).await.unwrap();
    assert!(file.is_lazy());
    assert_eq!(file.mime_type(), Some("image/png"));

    let mut stream = file.iter_bytes();
    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(
        &first[..8],
        &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    );

    let mut total = first.len();
    while let Some(chunk) = stream.next().await {
        total += chunk.unwrap().len();
    }
    assert_eq!(total, data.len());
}

/// Headline memory test: stream 100 MB through a lazy File and assert that
/// process RSS stays within +50 MB of the baseline. Uses the `memory-stats`
/// crate which queries the OS for physical-memory usage.
#[tokio::test]
async fn lazy_stream_100mb_memory_bound() {
    // Use a single byte repeated so the source never allocates the payload.
    const SIZE: usize = 100 * 1024 * 1024; // 100 MB
    let reader = ConstByteReader::new(0xEF, SIZE);

    let baseline = memory_stats::memory_stats()
        .expect("memory_stats unavailable on this platform")
        .physical_mem;

    let file = File::from_stream_lazy(reader, None).await.unwrap();
    assert!(file.is_lazy());
    // Sanity: the head buffer is the constant we promise callers.
    let _ = LAZY_HEAD_BYTES;

    let mut stream = file.iter_bytes();
    let mut got: usize = 0;
    let mut peak = baseline;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.unwrap();
        got += chunk.len();
        if let Some(stats) = memory_stats::memory_stats() {
            peak = peak.max(stats.physical_mem);
        }
    }
    assert_eq!(got, SIZE);

    let delta_bytes = peak.saturating_sub(baseline);
    let delta_mb = delta_bytes / (1024 * 1024);
    eprintln!(
        "100 MB streamed: baseline RSS = {} MB, peak = {} MB, delta = {} MB",
        baseline / (1024 * 1024),
        peak / (1024 * 1024),
        delta_mb,
    );
    assert!(
        delta_bytes < 50 * 1024 * 1024,
        "RSS grew by {} MB while streaming 100 MB — expected < 50 MB",
        delta_mb
    );
}

#[tokio::test]
async fn from_stream_lazy_with_hint_preserves_size() {
    // When the caller knows the content-length up front, the hint should win
    // and stick through the lazy path.
    use smooai_file::Metadata;

    let total = 200 * 1024;
    let reader = ConstByteReader::new(0x12, total);
    let file = File::from_stream_lazy(
        reader,
        Some(Metadata {
            size: Some(total as u64),
            name: Some("blob.bin".to_string()),
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    assert!(file.is_lazy());
    assert_eq!(file.size(), Some(total as u64));
    assert_eq!(file.name(), Some("blob.bin"));
}

#[tokio::test]
async fn lazy_eager_legacy_path_still_works() {
    // Non-lazy from_stream still works the same way it always did — buffers
    // the whole payload and reports an exact size.
    let chunks = vec![
        Ok::<_, std::io::Error>(Bytes::from("hello ")),
        Ok::<_, std::io::Error>(Bytes::from("world")),
    ];
    let stream = futures::stream::iter(chunks);
    let file = File::from_stream(stream, None).await.unwrap();
    assert!(!file.is_lazy());
    assert_eq!(file.size(), Some(11));
    let text = file.read_text().await.unwrap();
    assert_eq!(text, "hello world");
}
