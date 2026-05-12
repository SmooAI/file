---
'@smooai/file': patch
---

SMOODEV-967: Lazy streaming support in Rust, Go, and .NET.

The Python port shipped lazy streaming in SMOODEV-952; this change brings the same semantics to the other three ports. Constructing a file from a large stream no longer requires buffering the whole payload in memory.

- **Rust**: New `File::from_stream_lazy(reader, hint)` that takes any `AsyncRead + Send + Unpin + 'static` and pulls only the first 64 KB (`LAZY_HEAD_BYTES`) for magic-byte detection. The tail stays in the reader and is consumed by `read()`, `iter_bytes()`, or `upload_to_s3()`. Uploads spool through a temp file so the AWS SDK gets a seekable body without RAM-buffering the payload.
- **Go**: New `NewFromStreamLazy(reader, hints...)` and a public `IterBytes(ctx) (<-chan []byte, <-chan error)` method. `UploadToS3WithContext` streams lazy files through a temp-file spool.
- **.NET**: `CreateFromStreamAsync(stream, ..., lazy: true)` (and a `CreateFromStreamLazyAsync` shorthand). New `OpenReadStream()` returns a `HeadAndTailStream` view that yields the detection head followed by the lazy tail. `S3SmooFile.UploadToS3Async` uses `TransferUtility` (multipart streaming) for lazy files.

100 MB streaming tests in all three languages assert RSS/heap delta stays under 50 MB.
