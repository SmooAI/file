---
'@smooai/file': patch
---

**Rust: a detection-only build.** The crate's I/O `File` type (local, URL, stream and S3 sources) is now behind a `file` feature, on by default, so existing users see no change. With `default-features = false`, `smooai-file` is just magic-byte detection (`detection`), `content_disposition` and the validation error types, and depends on only `infer`, `mime_guess` and `thiserror`, with no AWS SDK, reqwest or tokio. That makes it usable from a service's core library that only needs to sniff bytes it already holds, which is where dogfooding needs it: the Smoo AI media pipeline had two hand-written `infer` sniffers that drifted apart. CI now checks both builds.

**Rust: `infer` 0.16 → 0.19** for newer magic-number signatures.

**.NET: SourceLink 8.0.0 → 10.0.303.** `Microsoft.Build.Tasks.Git` 8.0.0 picked up advisory GHSA-23fw-v26w-5fgq (CVE-2026-62900), and with `TreatWarningsAsErrors` that failed every restore, which red-lit CI. This is build-time only (`PrivateAssets="All"`), so nothing ships to consumers.
