# SmooAI.File

.NET port of [`@smooai/file`](https://github.com/SmooAI/file). Provides a
`SmooFile` wrapper that uses [Mime-Detective](https://github.com/MediatedCommunications/Mime-Detective)
for magic-byte MIME detection and typed validation errors.

## Install

```bash
dotnet add package SmooAI.File
```

For S3 upload/download helpers, also add:

```bash
dotnet add package SmooAI.File.S3
```

The S3 helpers are intentionally split so apps that don't need AWS don't pull in `AWSSDK.S3`.

## Usage

```csharp
using SmooAI.File;

// From a stream (e.g. multipart upload)
await using var upload = formFile.OpenReadStream();
var file = await SmooFile.CreateFromStreamAsync(upload, options =>
{
    options.Name = formFile.FileName;
    options.MaxSizeBytes = 10_000_000;
    options.AllowedMimeTypes = new[] { "image/png", "image/jpeg", "application/pdf" };
});

file.Validate(
    maxSize: 10_000_000,
    allowedMimes: new[] { "image/png", "image/jpeg", "application/pdf" },
    expectedMimeType: formFile.ContentType);

// Read as base64 for an email attachment or data URL
var b64 = await file.ToBase64Async();

// Or save it to disk
await file.SaveToFileAsync("/tmp/upload.bin");
```

## Why magic-byte detection

File extensions and `Content-Type` headers lie. `file.docx` may actually be a
ZIP, a `.php` can be uploaded as `image/png`. `SmooFile.Detected.MimeType`
always reflects what the file actually contains, and `Validate(expectedMimeType:
…)` throws a typed `FileContentMismatchException` when claims disagree.

## Validation errors

All validation errors derive from `FileValidationException`, so one `catch`
block maps to a `400` response:

- `FileSizeException` — file exceeds `maxSize`
- `FileMimeException` — MIME not in `allowedMimes`
- `FileContentMismatchException` — client-claimed MIME disagrees with
  magic-byte-detected MIME

## License

MIT
