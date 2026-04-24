# SmooAI.File

**Magic-byte MIME detection, typed validation errors, and stream helpers for .NET — because `Content-Type` headers lie.**

.NET port of [`@smooai/file`](https://github.com/SmooAI/file). Built on [Mime-Detective](https://github.com/MediatedCommunications/Mime-Detective) for real MIME sniffing (not extension guessing). Wire-compatible semantics with the TypeScript, Python, Go, and Rust ports.

## Install

```bash
dotnet add package SmooAI.File
```

Need S3 upload/download helpers? Add the companion package:

```bash
dotnet add package SmooAI.File.S3
```

Split on purpose — apps that only need MIME detection and validation don't pull in `AWSSDK.S3`.

## Quick start

```csharp
using SmooAI.File;

// From an ASP.NET Core upload
await using var upload = formFile.OpenReadStream();
var file = await SmooFile.CreateFromStreamAsync(upload, options =>
{
    options.Name             = formFile.FileName;
    options.ExpectedMimeType = formFile.ContentType;   // client-claimed
    options.MaxSizeBytes     = 10_000_000;
    options.AllowedMimeTypes = new[] { "image/png", "image/jpeg", "application/pdf" };
});

// One call — throws typed exceptions on violation
file.Validate();

// Detected MIME reflects what the bytes *actually* are
Console.WriteLine(file.Detected.MimeType);   // e.g. "image/png"

// Emit as base64 for an email attachment / data URL
var b64 = await file.ToBase64Async();

// Or persist
await file.SaveToFileAsync("/tmp/upload.bin");
```

## Why magic-byte detection

File extensions and `Content-Type` headers are untrusted client input. `file.docx` may actually be a ZIP. A `.php` can masquerade as `image/png`. `SmooFile.Detected.MimeType` reflects the real bytes — and `Validate(expectedMimeType: …)` throws `FileContentMismatchException` the moment claim disagrees with content.

```csharp
// Client uploads a PHP shell renamed to avatar.png
var file = await SmooFile.CreateFromStreamAsync(stream, opts =>
{
    opts.Name             = "avatar.png";
    opts.ExpectedMimeType = "image/png";
});

file.Validate(allowedMimes: new[] { "image/png", "image/jpeg" });
// -> throws FileContentMismatchException
//    Detected: "text/x-php", Expected: "image/png"
```

## Validation errors

One base class — one `catch` block on the controller. All typed, all actionable, all 400-worthy:

| Exception                      | When                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `FileSizeException`            | File exceeds `maxSize`                                      |
| `FileMimeException`            | MIME not in `allowedMimes`                                  |
| `FileContentMismatchException` | Client-claimed MIME disagrees with magic-byte-detected MIME |
| `FileValidationException`      | Base class — catch this to handle all validation failures   |

```csharp
try
{
    file.Validate();
}
catch (FileValidationException ex)
{
    return Results.Problem(ex.Message, statusCode: 400);
}
```

## Creating from other sources

```csharp
// From a byte buffer
var file = await SmooFile.CreateFromBytesAsync(bytes, opts => { opts.Name = "thing.bin"; });

// From a file path
var file = await SmooFile.CreateFromPathAsync("/tmp/upload.bin");

// From a URL (streams, doesn't buffer the full body into memory)
var file = await SmooFile.CreateFromUrlAsync("https://example.com/report.pdf");
```

## Related

- [`SmooAI.File.S3`](https://www.nuget.org/packages/SmooAI.File.S3) — presigned uploads + S3 helpers (split package)
- [`@smooai/file`](https://www.npmjs.com/package/@smooai/file) — TypeScript / Node
- [`smooai-file`](https://crates.io/crates/smooai-file) — Rust
- [`smooai-file`](https://pypi.org/project/smooai-file/) — Python
- [`github.com/SmooAI/file/go/file`](https://github.com/SmooAI/file/tree/main/go/file) — Go

## License

MIT — © SmooAI
