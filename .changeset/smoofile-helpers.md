---
'@smooai/file': minor
---

SMOODEV-622: Add `createFromWebFile`, `validate()`, typed errors, `toBase64`, and `createPresignedUploadUrl` helpers for cleaner adoption in upload routes, knowledge ingestion, and email attachments.

- `SmooFile.createFromWebFile(webFile)` — one-line constructor from browser `File` / `Blob` / Hono-multipart `File`; preserves `name` and `type` hints.
- `.validate({ maxSize, allowedMimes, expectedMimeType })` — throws typed errors for uniform 400 mapping. `expectedMimeType` compares magic-byte detection against the claimed Content-Type, preventing mime spoofing.
- Exported error types: `FileValidationError`, `FileSizeError`, `FileMimeError`, `FileContentMismatchError`.
- `.toBase64()` — one-shot helper for email attachments and data URLs.
- `SmooFile.createPresignedUploadUrl({ bucket, key, contentType, expiresIn, maxSize })` — centralizes the server-signs + client-uploads pattern.

TypeScript-only in this release; Python / Rust / Go parity follows in a separate ticket.
