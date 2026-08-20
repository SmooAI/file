---
'@smooai/file': patch
---

Fix silent truncation of multi-chunk reads, and give TypeScript the lazy streaming the other four ports have had since May.

**Data-loss fix.** `readFileBytes()`, `uploadToS3()` and the private `toBuffer()` were each a single `await stream.read()`, which returns only what a Node stream happens to have buffered — one chunk. Anything arriving in more than one chunk was silently cut short, and everything downstream inherited it: `readFileString`, `toBase64`, `toFormData`, `getChecksum`, `saveToS3`, `prepend`. Measured before the fix: `createFromFile()` on a 300,000-byte file returned 131,072 bytes with `size` correctly reporting 300,000, and `getChecksum()` returned the hash of the truncated prefix. All three now drain the stream.

**Lazy streaming.** New `File.createFromStreamLazy(stream, hint)` pulls only `LAZY_HEAD_BYTES` (64 KiB, now exported) for magic-byte detection and leaves the tail in the source, matching `from_stream(lazy=True)` / `from_stream_lazy` / `NewFromStreamLazy` / `CreateFromStreamLazyAsync`. `createFromStream` is now explicitly the eager constructor: it buffers the payload and reports an exact `size`. New `file.iterBytes()` yields the payload chunk by chunk without buffering it, and `file.isLazy` reports whether the payload has been materialised.

**Shared contract.** `spec/lazy-stream-contract.json` pins the semantics — head size, what stays lazy, when `size` is known, what a full read and a full iteration each do — and all five test suites load it. Writing it caught two more real bugs in Rust: a second `read()` on a lazy file returned just the 64 KiB head instead of the cached payload, and a `read()` after `iter_bytes()` replayed the head as if it were the whole file. Both are silent truncation; `read()` now caches and a drained tail reports as empty.

Also: `python/src/smooai_file/__init__.py` gains `File.is_lazy`, and Go gains `(*File).IsLazy()`, so all five expose the same accessor.
