---
'@smooai/file': patch
---

Make the validation-error taxonomy portable across all five ports, and add `SetMetadata` to .NET.

Catching by type doesn't survive the language boundary: TypeScript, Python and .NET raise three distinct classes, Rust collapses them into one enum, and Go returns one struct with a `Kind` field. Code meant to behave the same in more than one port had nothing to branch on. All five now carry the same `kind` discriminant — `"size"`, `"mime"`, `"content_mismatch"` — alongside the existing shapes, so nothing about the published APIs changes. `spec/error-taxonomy.json` pins the values and the structured fields each one carries, and all five test suites load it.

`SmooFile.SetMetadata` closes the one arbitrary gap in the matrix: every other port already had it.

Also corrects two README rows this work proved wrong. `downloadFromS3` was marked ✅ for Rust and Go, but only Python writes an S3 object to a local path — Rust's is a plain alias for `from_s3` and Go's replaces the receiver in place, neither touching the filesystem.
