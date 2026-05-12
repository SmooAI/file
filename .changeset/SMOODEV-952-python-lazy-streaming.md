---
'@smooai/file': patch
---

SMOODEV-952: Python — true lazy streaming for `File.from_stream`. The README pitch is "2 GB upload doesn't blow your Lambda memory," and now Python actually keeps that promise.

`File.from_stream(stream, lazy=True)` (default) buffers only the first 64 KB up-front for magic-byte detection; the remaining tail stays in the source generator and is drained chunk-by-chunk by `read()`, the new `iter_bytes()` async generator, or `upload_to_s3()` (which routes the tail through a `SpooledTemporaryFile` and `boto3.upload_fileobj`'s multipart streaming so peak memory stays bounded). Pass `lazy=False` to opt back into the legacy fully-buffered behavior.

100 MB synthetic-stream test caps peak process RSS delta at 50 MB during consumption — used to blow past 100 MB.

Follow-up tickets needed for Rust, Go, and .NET ports.
