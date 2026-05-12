---
'@smooai/file': patch
---

SMOODEV-955: Add `toFormData` / `ToFormData` / `to_form_data` to Python, Rust, Go, and .NET ports. Brings them to parity with the TS API for relay/proxy scenarios where the file needs to be re-uploaded as a multipart form field. Each port returns a payload native to its idiomatic HTTP client (httpx `files=` dict in Python, `reqwest::multipart::Form` in Rust, `*FormData` struct with multipart body+content-type in Go, `MultipartFormDataContent` in .NET).
