# @smooai/file

## 2.2.20

### Patch Changes

- d4cb3a3: Three release and test traps that each report success while doing nothing.

    **`go test ./...` served a cached pass against a corrupted fixture.** Go's build cache doesn't invalidate on a file loaded from outside the package directory, which is exactly the shape of the shared contract fixtures under `spec/`. Verified: zeroing every `sha256` and setting `headBytes` to 999 still printed `ok (cached)`. `go:test` now passes `-count=1`, and the same corruption fails immediately. Until this, the Go quarter of the five-port lazy contract proved nothing.

    **`release.yml` ran `pnpm format` in write mode.** Whatever it rewrote was either swept into the release commit unreviewed, or — in publish mode, where the changesets action commits nothing — left the tree dirty for `cargo publish --locked`, which would fail every release now that `--allow-dirty` is gone. The workflow now runs `format:check`, and the formatting the release genuinely needs runs inside `pnpm run version`, before the action commits. Changesets' generated `CHANGELOG.md` is confirmed not oxfmt-clean, so without that ordering `format:check` would redden every future release PR.

    **Publishing to PyPI, crates.io, NuGet and the Go tag was gated on npm having published in the same run.** If npm succeeded and a later step failed, the retry found nothing new for npm, so all four skipped — a green run that published nothing, stranding four ports on the previous release indefinitely. Each step is now gated on whether its own registry carries `package.json`'s version, so a retry ships exactly what is missing, and a final step fails the run if npm published a version the others didn't.

## 2.2.19

### Patch Changes

- edc71da: Add the zero-byte case to the lazy-streaming contract, and give Go a way to say "size not measured".

    `spec/lazy-stream-contract.json` pinned 1 KiB, 64 KiB and 1 MiB sources but not the 0-byte boundary, where "shorter than the detection head" degenerates. Empty S3 objects and zero-length uploads are real — this repo already ships `empty.txt` as a fixture.

    Adding it immediately failed the Go loader, for a real reason: `Size() int64` cannot express "unknown". Go has no optional integer, so `Size() == 0` was doing double duty for an empty file and for a lazy stream whose tail nobody had counted — the other four ports say the latter with `nil` / `None` / `undefined`. New `(*File).SizeKnown() bool` separates them. Additive and non-breaking: the field's zero value means "known", so every eager constructor stays correct untouched.

## 2.2.18

### Patch Changes

- 98a54c7: Two ways the TypeScript suite could pass without testing anything, closed.

    `server.listen()` used MSW's default `onUnhandledRequest: 'warn'`, which passes the request through to the real network — a typo in the S3 bucket or region would have sent a signed request to real AWS and printed a warning nobody reads. Now `'error'`.

    `vitest.config.mts` set `passWithNoTests: true`, which turns "vitest matched no files" — a broken glob, a moved directory, a renamed extension — into a green run. Removed, with an explicit `include`.

## 2.2.17

### Patch Changes

- 3768067: Stop making every consumer pay for the AWS SDK, and move `typescript` out of runtime dependencies.

    `typescript` was an unconditional runtime `dependency` even though nothing under `src/` imports it — it is a build tool. Now a devDependency.

    The two `@aws-sdk/*` packages were imported at the top of `src/File.ts`, and an `S3Client` was constructed as a class field on every `File` instance, including ones created from a local path. So `import File from '@smooai/file'` loaded 30 SDK modules whether or not you ever touched S3. They are now behind `import type` (erased at compile time) and `await import(...)` (memoised by the module system), and the instance client is built on first use.

    Measured on the built package: **~180ms off a cold `import`, roughly 40% of the total.** `scripts/check-lazy-s3.mjs` runs as `postbuild` and fails if the SDK ever re-enters the import graph, which one `import { S3Client }` written without `import type` would do.

    No API change. The SDKs stay in `dependencies` — making them optional peers would break existing consumers who use S3, so that is tracked separately.

## 2.2.16

### Patch Changes

- 011a035: Make the .NET port visible to the local quality gates.

    `package.json` had no `dotnet:*` scripts, so `pnpm test`, `pnpm build`, `pnpm format:check` and `pnpm check-all` — which CLAUDE.md calls "full CI parity" — all silently skipped one of the five ports. The only thing exercising .NET was a separate trailing step in `pr-checks.yml`, so a developer could run every local gate green and still break the port.

    Adds `dotnet:build`, `dotnet:test`, `dotnet:format` and `dotnet:format:check`, wires them into `build`, `test`, `format` and `format:check`, and folds the per-language format checks into `format:check` so the local gate and CI cannot disagree about what "formatted" means. `check-all` gets shorter as a result, without losing coverage. The .NET SDK is now a prerequisite for `pnpm test` — documented in CLAUDE.md, which had no .NET section at all.

- 751d5fe: Make the validation-error taxonomy portable across all five ports, and add `SetMetadata` to .NET.

    Catching by type doesn't survive the language boundary: TypeScript, Python and .NET raise three distinct classes, Rust collapses them into one enum, and Go returns one struct with a `Kind` field. Code meant to behave the same in more than one port had nothing to branch on. All five now carry the same `kind` discriminant — `"size"`, `"mime"`, `"content_mismatch"` — alongside the existing shapes, so nothing about the published APIs changes. `spec/error-taxonomy.json` pins the values and the structured fields each one carries, and all five test suites load it.

    `SmooFile.SetMetadata` closes the one arbitrary gap in the matrix: every other port already had it.

    Also corrects two README rows this work proved wrong. `downloadFromS3` was marked ✅ for Rust and Go, but only Python writes an S3 object to a local path — Rust's is a plain alias for `from_s3` and Go's replaces the receiver in place, neither touching the filesystem.

## 2.2.15

### Patch Changes

- 3d8c29e: Make the TypeScript S3 ingest tests actually run.

    `src/File.integration.spec.ts` had `describe.skip('createFromS3')` with the note "Only works when logged in to AWS for smoo.dev" — seven tests that read as coverage while asserting nothing. `createFromS3` was the only ingest path in the TypeScript port with no executing test, while Python (`moto`) and .NET both test theirs.

    The AWS SDK v3 speaks plain HTTPS, so the seven tests now run against MSW-intercepted S3 responses served from the same fixture files the local-file tests use. That exercises the real client — request signing, XML error parsing, streamed response body — with no AWS account, no credentials, and no container. `msw` was already a devDependency of this repo and already used in this file.

## 2.2.14

### Patch Changes

- 92f44eb: Fix silent truncation of multi-chunk reads, and give TypeScript the lazy streaming the other four ports have had since May.

    **Data-loss fix.** `readFileBytes()`, `uploadToS3()` and the private `toBuffer()` were each a single `await stream.read()`, which returns only what a Node stream happens to have buffered — one chunk. Anything arriving in more than one chunk was silently cut short, and everything downstream inherited it: `readFileString`, `toBase64`, `toFormData`, `getChecksum`, `saveToS3`, `prepend`. Measured before the fix: `createFromFile()` on a 300,000-byte file returned 131,072 bytes with `size` correctly reporting 300,000, and `getChecksum()` returned the hash of the truncated prefix. All three now drain the stream.

    **Lazy streaming.** New `File.createFromStreamLazy(stream, hint)` pulls only `LAZY_HEAD_BYTES` (64 KiB, now exported) for magic-byte detection and leaves the tail in the source, matching `from_stream(lazy=True)` / `from_stream_lazy` / `NewFromStreamLazy` / `CreateFromStreamLazyAsync`. `createFromStream` is now explicitly the eager constructor: it buffers the payload and reports an exact `size`. New `file.iterBytes()` yields the payload chunk by chunk without buffering it, and `file.isLazy` reports whether the payload has been materialised.

    **Shared contract.** `spec/lazy-stream-contract.json` pins the semantics — head size, what stays lazy, when `size` is known, what a full read and a full iteration each do — and all five test suites load it. Writing it caught two more real bugs in Rust: a second `read()` on a lazy file returned just the 64 KiB head instead of the cached payload, and a `read()` after `iter_bytes()` replayed the head as if it were the whole file. Both are silent truncation; `read()` now caches and a drained tail reports as empty.

    Also: `python/src/smooai_file/__init__.py` gains `File.is_lazy`, and Go gains `(*File).IsLazy()`, so all five expose the same accessor.

## 2.2.13

### Patch Changes

- 028ef26: Fix the release pipeline so version metadata stops drifting, and give the Go module a resolvable path.

    `version:sync` used to run _after_ `changeset publish`, mutating manifests in a CI workspace that nobody committed — so every git tag shipped stale version constants (`go/file/v2.2.12` contained `Version = "1.1.5"`) and `cargo publish` needed `--allow-dirty` to paper over the difference. The sync now runs in the changesets `version` lifecycle, where the action commits the result into the release commit.
    - `scripts/version-targets.mjs` is now the single list of version-bearing files; `sync-versions.mjs` writes it and the new `sync-versions` guard (`pnpm version:check`) asserts it, in both PR checks and release. A pattern that matches nothing is now an error instead of a silent "already up to date".
    - `rust/file/Cargo.lock` is stamped alongside `Cargo.toml`, so `cargo publish` runs `--locked` with no `--allow-dirty`.
    - The Go module path is now `github.com/SmooAI/file/go/file/v2`, which is what Go requires for major >= 2 — the existing `go/file/v2.x` tags resolved nothing without it. The suffix is derived from `package.json`, checked by `version:check`, and re-asserted immediately before the release tag is pushed.

    No TypeScript API change.

## 2.2.12

### Patch Changes

- 3d28f59: Drop create-entry-points dependency from build — freeze entry list in tsdown.config.ts + package.json exports. No public API change.

## 2.2.11

### Patch Changes

- dd2ab81: Migrate build tooling from tsup to tsdown — faster, oxc-based, drop-in replacement. Output extensions shift from `.js`/`.mjs`/`.d.ts` to `.cjs`/`.mjs`/`.d.cts`/`.d.mts` (tsdown defaults); the `exports` map is updated to match, so subpath imports continue to resolve transparently. Also bumps `@smooai/utils` to ^1.3.4 to pick up the tsdown-aware `create-entry-points` CLI. No public API change.

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
