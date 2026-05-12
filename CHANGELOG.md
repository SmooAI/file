# @smooai/file

## 2.2.10

### Patch Changes

- 7ab63cc: SMOODEV-967: Lazy streaming support in Rust, Go, and .NET.

    The Python port shipped lazy streaming in SMOODEV-952; this change brings the same semantics to the other three ports. Constructing a file from a large stream no longer requires buffering the whole payload in memory.
    - **Rust**: New `File::from_stream_lazy(reader, hint)` that takes any `AsyncRead + Send + Unpin + 'static` and pulls only the first 64 KB (`LAZY_HEAD_BYTES`) for magic-byte detection. The tail stays in the reader and is consumed by `read()`, `iter_bytes()`, or `upload_to_s3()`. Uploads spool through a temp file so the AWS SDK gets a seekable body without RAM-buffering the payload.
    - **Go**: New `NewFromStreamLazy(reader, hints...)` and a public `IterBytes(ctx) (<-chan []byte, <-chan error)` method. `UploadToS3WithContext` streams lazy files through a temp-file spool.
    - **.NET**: `CreateFromStreamAsync(stream, ..., lazy: true)` (and a `CreateFromStreamLazyAsync` shorthand). New `OpenReadStream()` returns a `HeadAndTailStream` view that yields the detection head followed by the lazy tail. `S3SmooFile.UploadToS3Async` uses `TransferUtility` (multipart streaming) for lazy files.

    100 MB streaming tests in all three languages assert RSS/heap delta stays under 50 MB.

## 2.2.9

### Patch Changes

- b9293e6: SMOODEV-951: Bring Python, Rust, Go, and .NET to parity with TS's `createFromWebFile` (overdue v2.1.0 follow-up). Each port adds an idiomatic factory for ingesting a form/multipart upload from a web framework:
    - Python: `File.from_form_upload(upload)` — accepts any object exposing `filename` + `content_type` + `read()` (Starlette `UploadFile`, FastAPI `UploadFile`, aiohttp `FileField`)
    - Rust: `File::from_form_upload(bytes, filename, content_type)` — framework-agnostic; callers pull these fields from axum/actix Multipart fields
    - Go: `NewFromMultipartFile(*multipart.FileHeader)` — stdlib `net/http` multipart type
    - .NET: `SmooFile.CreateFromFormFileAsync(Stream, fileName, contentType)` — callers pass `IFormFile.OpenReadStream(), FileName, ContentType` to avoid forcing the ASP.NET dep on every consumer

- e529eef: SMOODEV-952: Python — true lazy streaming for `File.from_stream`. The README pitch is "2 GB upload doesn't blow your Lambda memory," and now Python actually keeps that promise.

    `File.from_stream(stream, lazy=True)` (default) buffers only the first 64 KB up-front for magic-byte detection; the remaining tail stays in the source generator and is drained chunk-by-chunk by `read()`, the new `iter_bytes()` async generator, or `upload_to_s3()` (which routes the tail through a `SpooledTemporaryFile` and `boto3.upload_fileobj`'s multipart streaming so peak memory stays bounded). Pass `lazy=False` to opt back into the legacy fully-buffered behavior.

    100 MB synthetic-stream test caps peak process RSS delta at 50 MB during consumption — used to blow past 100 MB.

    Follow-up tickets needed for Rust, Go, and .NET ports.

- 3499ab2: SMOODEV-955: Add `toFormData` / `ToFormData` / `to_form_data` to Python, Rust, Go, and .NET ports. Brings them to parity with the TS API for relay/proxy scenarios where the file needs to be re-uploaded as a multipart form field. Each port returns a payload native to its idiomatic HTTP client (httpx `files=` dict in Python, `reqwest::multipart::Form` in Rust, `*FormData` struct with multipart body+content-type in Go, `MultipartFormDataContent` in .NET).

## 2.2.8

### Patch Changes

- 799de6b: SMOODEV-954: Go — extend `CreatePresignedUploadURL` with `ContentDisposition` option so callers can pre-set the suggested filename for downloads (`attachment; filename="..."`) baked into the signed PUT URL. Brings Go to parity with TS/Rust/Python/.NET.

## 2.2.7

### Patch Changes

- 4403877: SMOODEV-953: .NET — add Content-Disposition parser (RFC 6266 / RFC 5987) and wire it into the URL and S3 download flows so `SmooFile.Name` picks up server-suggested filenames (including UTF-8 encoded ones) instead of silently falling back to the URL basename or S3 key.

## 2.2.6

### Patch Changes

- 9df7f93: SMOODEV-956: Fix Python README — `python/README.md` listed `python-magic` as the magic-byte MIME detector, but the package actually ships `puremagic` (per `pyproject.toml` + `_detection.py`, and noted in the 2.0.0 changelog). Update the "Built With" entry so Python users don't pip-install the wrong library.

## 2.2.5

### Patch Changes

- 241d7c0: SMOODEV-928: Bump `@smooai/logger` to `^4.1.4`, `@smooai/utils` to `^1.3.3`, and `@smooai/fetch` to `^3.3.5` (major jump from prior `^2.1.0` range, but the TS API is unchanged from fetch 2.x to 3.x — the 3.0 major was for adding Python/Rust/Go ports). Picks up the ESM `__filename` TDZ fix from logger 4.1.4 transitively. Also drops deprecated `baseUrl: "./"` from tsconfig (TS 5.9+/6.x reject it with TS5101).

## 2.2.4

### Patch Changes

- 08c8f83: SMOODEV-667: Fix release pipeline so PyPI + crates.io + NuGet actually publish. `pnpm build` produces a Python wheel at the pre-sync version (the Cargo/pyproject bumps happen later, inside `ci:publish`), so the publish step was trying to re-upload the stale wheel and getting rejected. Clean `dist/` before `uv run poe publish` so only the freshly-built version ships. Drop `--locked` from the cargo publish step because sync-versions only updates `Cargo.toml` (not `Cargo.lock`), which would trip `--locked` as soon as crates.io is reached. Net effect: `SmooAI.File` + `SmooAI.File.S3` NuGet packages publish for the first time; PyPI advances from the stalled 2.0.0.

## 2.2.3

### Patch Changes

- 73f2d34: SMOODEV-666: Multi-target the SmooAI.File and SmooAI.File.S3 NuGet packages to `net8.0;net9.0;net10.0` so consumers on every current .NET LTS + STS release get a native `lib/` folder match. Mime-Detective 25.8.1 and AWSSDK.S3 4.0.22 resolve cleanly on all three TFMs — no per-TFM conditionals needed. Also bumped the repo's `dotnet/global.json` rollForward from `latestFeature` to `latestMajor` so the SDK 10 runner can satisfy the 8.0.0 floor.

## 2.2.2

### Patch Changes

- 532173e: SMOODEV-664: Rewrite READMEs to value-frame the package — lead with "file operations that don't lie": magic-byte MIME detection vs spoofed extensions, size + content validation, presigned S3 uploads. Drop the "powerful file handling library" stock lead and reorder "Key Features" so validation comes first. Republishes @smooai/file on npm plus SmooAI.File and SmooAI.File.S3 on NuGet with the new READMEs.

## 2.2.1

### Patch Changes

- 6c73caf: SMOODEV-662: Sync SmooAI.File + SmooAI.File.S3 NuGet versions to package.json + polish NuGet READMEs

## 2.2.0

### Minor Changes

- cb8bb64: Add .NET (C#) port of `@smooai/file` as NuGet packages `SmooAI.File` and
  `SmooAI.File.S3`.

    `SmooAI.File` exposes `SmooFile.CreateFromStreamAsync` / `CreateFromBytesAsync`
    / `CreateFromFileAsync` / `CreateFromUrlAsync`, `Validate` with typed
    `FileValidationException` subclasses (`FileSizeException`,
    `FileMimeException`, `FileContentMismatchException`), and `ToBase64Async`. MIME
    detection uses [Mime-Detective](https://github.com/MediatedCommunications/Mime-Detective)
    magic-byte inspection so extensions and `Content-Type` headers can't lie about
    the content.

    `SmooAI.File.S3` is a split sub-package that adds S3 helpers
    (`CreateFromS3Async`, `CreatePresignedUploadUrlAsync`,
    `CreatePresignedDownloadUrlAsync`, `UploadToS3Async`) without forcing the AWS
    SDK on core consumers.

## 2.1.0

### Minor Changes

- be50ef5: SMOODEV-622: Add `createFromWebFile`, `validate()`, typed errors, `toBase64`, and `createPresignedUploadUrl` helpers for cleaner adoption in upload routes, knowledge ingestion, and email attachments.
    - `SmooFile.createFromWebFile(webFile)` — one-line constructor from browser `File` / `Blob` / Hono-multipart `File`; preserves `name` and `type` hints.
    - `.validate({ maxSize, allowedMimes, expectedMimeType })` — throws typed errors for uniform 400 mapping. `expectedMimeType` compares magic-byte detection against the claimed Content-Type, preventing mime spoofing.
    - Exported error types: `FileValidationError`, `FileSizeError`, `FileMimeError`, `FileContentMismatchError`.
    - `.toBase64()` — one-shot helper for email attachments and data URLs.
    - `SmooFile.createPresignedUploadUrl({ bucket, key, contentType, expiresIn, maxSize })` — centralizes the server-signs + client-uploads pattern.

    TypeScript-only in this release; Python / Rust / Go parity follows in a separate ticket.

## 2.0.1

### Patch Changes

- 9315676: Add Python, Rust, and Go language-specific READMEs with idiomatic usage examples, cross-language install table, and API reference.

## 2.0.0

### Major Changes

- 6b5b8e2: Implement file library in Python, Rust, and Go
    - Python: Async file handling with puremagic detection, S3 via boto3, aiofiles, metadata pipeline matching TypeScript (98 tests)
    - Rust: File handling with infer + custom SVG/XML detection, aws-sdk-s3, SHA-256 checksums, Content-Disposition parsing (99 tests)
    - Go: File handling with gabriel-vasile/mimetype detection, aws-sdk-go-v2 for S3, dependency injection for testability (121 tests)

## 1.1.5

### Patch Changes

- 1b2aebd: Fix bug with S3Client usage.
- e59d9a1: Add SmooAI Packages section to README with link to smoo.ai/open-source for consistency across all SmooAI packages.

## 1.1.4

### Patch Changes

- f3ca33c: Fix bug with S3Client usage.

## 1.1.3

### Patch Changes

- c701114: Update @smooai/logger and other smoo dependencies.

## 1.1.2

### Patch Changes

- ffc04a8: Updating smoo dependencies.

## 1.1.1

### Patch Changes

- 342c972: Updating smoo dependencies.

## 1.1.0

### Minor Changes

- a18b3e7: Fix package exports.

## 1.0.7

### Patch Changes

- a4dae2d: Update readme.

## 1.0.6

### Patch Changes

- 32ed390: Update prettier plugins.

## 1.0.5

### Patch Changes

- a0b764f: Added JSDoc to public interfaces.

## 1.0.4

### Patch Changes

- f06c94a: Update to publish to npm.

## 1.0.3

### Patch Changes

- 3b2c36a: Adding fully tested File library ready for publishing.

## 1.0.2

### Patch Changes

- 44fd23b: Fix publish for Github releases.

## 1.0.1

### Patch Changes

- 52c9eb1: Initial check-in.
