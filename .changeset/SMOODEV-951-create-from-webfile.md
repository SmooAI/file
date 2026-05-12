---
'@smooai/file': patch
---

SMOODEV-951: Bring Python, Rust, Go, and .NET to parity with TS's `createFromWebFile` (overdue v2.1.0 follow-up). Each port adds an idiomatic factory for ingesting a form/multipart upload from a web framework:

- Python: `File.from_form_upload(upload)` — accepts any object exposing `filename` + `content_type` + `read()` (Starlette `UploadFile`, FastAPI `UploadFile`, aiohttp `FileField`)
- Rust: `File::from_form_upload(bytes, filename, content_type)` — framework-agnostic; callers pull these fields from axum/actix Multipart fields
- Go: `NewFromMultipartFile(*multipart.FileHeader)` — stdlib `net/http` multipart type
- .NET: `SmooFile.CreateFromFormFileAsync(Stream, fileName, contentType)` — callers pass `IFormFile.OpenReadStream(), FileName, ContentType` to avoid forcing the ASP.NET dep on every consumer
