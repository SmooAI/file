---
'@smooai/file': minor
---

Add .NET (C#) port of `@smooai/file` as NuGet packages `SmooAI.File` and
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
