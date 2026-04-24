# @smooai/file

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
