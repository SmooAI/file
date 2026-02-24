//! Full pipeline integration tests.

use bytes::Bytes;
use smooai_file::{File, FileSource, Metadata};
use std::io::Write;
use tempfile::NamedTempFile;

/// Full pipeline: bytes -> save to disk -> read back -> checksum
#[tokio::test]
async fn test_bytes_to_disk_roundtrip() {
    let original_content = "Integration test content for roundtrip.";
    let data = Bytes::from(original_content);

    // Create from bytes
    let file = File::from_bytes(
        data,
        Some(Metadata {
            name: Some("roundtrip.txt".to_string()),
            mime_type: Some("text/plain".to_string()),
            ..Default::default()
        }),
    )
    .await
    .unwrap();

    assert_eq!(file.source(), FileSource::Bytes);
    assert_eq!(file.name(), Some("roundtrip.txt"));
    assert_eq!(file.mime_type(), Some("text/plain"));

    // Save to disk
    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("roundtrip.txt");
    let dest_str = dest.to_str().unwrap();

    let (original, saved) = file.save(dest_str).await.unwrap();

    // Verify original is still intact
    assert_eq!(original.read_text().await.unwrap(), original_content);

    // Verify saved file
    assert_eq!(saved.source(), FileSource::File);
    assert_eq!(saved.read_text().await.unwrap(), original_content);
    assert!(saved.path().is_some());
    assert!(saved.last_modified().is_some());
    assert!(saved.created_at().is_some());

    // Checksums should match
    let checksum_original = original.checksum().await.unwrap();
    let checksum_saved = saved.checksum().await.unwrap();
    assert_eq!(checksum_original, checksum_saved);
}

/// Full pipeline: file on disk -> read -> move -> verify original deleted
#[tokio::test]
async fn test_file_move_pipeline() {
    let content = "Move pipeline test content";

    // Create source file
    let mut tmp = NamedTempFile::new().unwrap();
    write!(tmp, "{}", content).unwrap();
    tmp.flush().unwrap();
    let source_path = tmp.path().to_string_lossy().to_string();

    // Load from disk
    let file = File::from_file(tmp.path(), None).await.unwrap();
    assert_eq!(file.source(), FileSource::File);

    // Verify content
    let text = file.read_text().await.unwrap();
    assert_eq!(text, content);

    // Move to new location
    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("moved.txt");
    let dest_str = dest.to_str().unwrap();

    let moved = file.move_to(dest_str).await.unwrap();

    // Verify moved file
    assert_eq!(moved.source(), FileSource::File);
    assert_eq!(moved.read_text().await.unwrap(), content);

    // Verify source deleted
    assert!(!std::path::Path::new(&source_path).exists());

    // Verify new file exists
    assert!(dest.exists());
}

/// Full pipeline: URL -> save to disk -> checksum
#[tokio::test]
async fn test_url_to_disk_pipeline() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let content = "Content from HTTP server";

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(content)
                .insert_header("content-type", "text/plain")
                .insert_header(
                    "content-disposition",
                    "attachment; filename=\"server-file.txt\"",
                ),
        )
        .mount(&server)
        .await;

    let url = format!("{}/server-file.txt", server.uri());

    // Fetch from URL
    let file = File::from_url(&url, None).await.unwrap();
    assert_eq!(file.source(), FileSource::Url);
    assert_eq!(file.name(), Some("server-file.txt"));
    assert_eq!(file.read_text().await.unwrap(), content);

    // Save to disk
    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("downloaded.txt");
    let dest_str = dest.to_str().unwrap();

    let (_, saved) = file.save(dest_str).await.unwrap();
    assert_eq!(saved.source(), FileSource::File);
    assert_eq!(saved.read_text().await.unwrap(), content);
}

/// Full pipeline: stream -> bytes -> checksum -> save
#[tokio::test]
async fn test_stream_to_disk_pipeline() {
    let chunks: Vec<std::result::Result<Bytes, std::io::Error>> = vec![
        Ok(Bytes::from("Line 1\n")),
        Ok(Bytes::from("Line 2\n")),
        Ok(Bytes::from("Line 3\n")),
    ];
    let stream = futures::stream::iter(chunks);

    let hint = Metadata {
        name: Some("streamed.txt".to_string()),
        ..Default::default()
    };

    let file = File::from_stream(stream, Some(hint)).await.unwrap();
    assert_eq!(file.source(), FileSource::Stream);
    assert_eq!(file.name(), Some("streamed.txt"));

    let text = file.read_text().await.unwrap();
    assert_eq!(text, "Line 1\nLine 2\nLine 3\n");

    // Checksum
    let checksum = file.checksum().await.unwrap();
    assert_eq!(checksum.len(), 64);

    // Save to disk
    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("streamed.txt");
    let dest_str = dest.to_str().unwrap();

    let (_, saved) = file.save(dest_str).await.unwrap();
    assert_eq!(saved.read_text().await.unwrap(), "Line 1\nLine 2\nLine 3\n");

    // Checksums must match
    let saved_checksum = saved.checksum().await.unwrap();
    assert_eq!(checksum, saved_checksum);
}

/// Full pipeline: binary content detection through multiple stages
#[tokio::test]
async fn test_binary_detection_pipeline() {
    // Create a PNG in memory
    let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[0; 100]);

    // From bytes
    let bytes_file = File::from_bytes(Bytes::from(png.clone()), None)
        .await
        .unwrap();
    assert_eq!(bytes_file.mime_type(), Some("image/png"));
    assert_eq!(bytes_file.extension(), Some("png"));

    // Save to disk
    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("test.png");
    let dest_str = dest.to_str().unwrap();

    let (_, disk_file) = bytes_file.save(dest_str).await.unwrap();
    assert_eq!(disk_file.mime_type(), Some("image/png"));
    assert_eq!(disk_file.extension(), Some("png"));

    // Checksums match
    let c1 = bytes_file.checksum().await.unwrap();
    let c2 = disk_file.checksum().await.unwrap();
    assert_eq!(c1, c2);
}

/// Pipeline: save, read back, save again to different location
#[tokio::test]
async fn test_double_save_pipeline() {
    let content = "Double save test";
    let file = File::from_bytes(Bytes::from(content), None).await.unwrap();

    let tmp_dir = tempfile::tempdir().unwrap();

    // First save
    let dest1 = tmp_dir.path().join("copy1.txt");
    let (_, saved1) = file.save(dest1.to_str().unwrap()).await.unwrap();

    // Second save from the saved copy
    let dest2 = tmp_dir.path().join("copy2.txt");
    let (_, saved2) = saved1.save(dest2.to_str().unwrap()).await.unwrap();

    assert_eq!(saved2.read_text().await.unwrap(), content);
    assert_eq!(
        saved1.checksum().await.unwrap(),
        saved2.checksum().await.unwrap()
    );
}

/// Pipeline: metadata hint override
#[tokio::test]
async fn test_metadata_hint_pipeline() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("data")
                .insert_header("content-type", "application/octet-stream"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/file", server.uri());

    // Provide a hint that overrides
    let hint = Metadata {
        name: Some("custom-name.csv".to_string()),
        ..Default::default()
    };

    let file = File::from_url(&url, Some(hint)).await.unwrap();
    assert_eq!(file.name(), Some("custom-name.csv"));
}

/// Pipeline: set_metadata after creation
#[tokio::test]
async fn test_set_metadata_pipeline() {
    let mut file = File::from_bytes(Bytes::from("hello"), None).await.unwrap();
    assert!(file.name().is_none());

    file.set_metadata(Metadata {
        name: Some("hello.txt".to_string()),
        mime_type: Some("text/plain".to_string()),
        ..Default::default()
    });

    assert_eq!(file.name(), Some("hello.txt"));
    assert_eq!(file.mime_type(), Some("text/plain"));
    // Size should not be overridden (still from data)
    assert_eq!(file.size(), Some(5));
}

/// Pipeline: multiple reads should return same data
#[tokio::test]
async fn test_multiple_reads() {
    let data = Bytes::from("read me multiple times");
    let file = File::from_bytes(data, None).await.unwrap();

    let read1 = file.read().await.unwrap();
    let read2 = file.read().await.unwrap();
    let text1 = file.read_text().await.unwrap();
    let text2 = file.read_text().await.unwrap();

    assert_eq!(read1, read2);
    assert_eq!(text1, text2);
    assert_eq!(text1, "read me multiple times");
}

/// URL fetch with all metadata headers
#[tokio::test]
async fn test_url_full_metadata() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let body = "full metadata test";

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(body)
                .insert_header("content-type", "text/plain; charset=utf-8")
                .insert_header("content-length", body.len().to_string().as_str())
                .insert_header("content-disposition", "attachment; filename=\"meta.txt\"")
                .insert_header("etag", "\"hash123\"")
                .insert_header("last-modified", "Mon, 01 Jan 2024 00:00:00 GMT")
                .insert_header("content-md5", "md5hash"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/meta.txt", server.uri());
    let file = File::from_url(&url, None).await.unwrap();

    assert_eq!(file.name(), Some("meta.txt"));
    assert_eq!(file.mime_type(), Some("text/plain"));
    assert_eq!(file.size(), Some(body.len() as u64));
    assert_eq!(file.hash(), Some("hash123"));
    assert!(file.last_modified().is_some());
}
