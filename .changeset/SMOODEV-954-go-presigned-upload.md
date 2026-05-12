---
'@smooai/file': patch
---

SMOODEV-954: Go — extend `CreatePresignedUploadURL` with `ContentDisposition` option so callers can pre-set the suggested filename for downloads (`attachment; filename="..."`) baked into the signed PUT URL. Brings Go to parity with TS/Rust/Python/.NET.
