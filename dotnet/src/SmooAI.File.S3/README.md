# SmooAI.File.S3

**S3 upload, download, and presigned-URL helpers for [`SmooAI.File`](https://www.nuget.org/packages/SmooAI.File) — typed, cancellable, and still magic-byte-safe.**

Companion package to [`SmooAI.File`](https://www.nuget.org/packages/SmooAI.File). Split on purpose — apps that only need local MIME detection and validation don't pay the `AWSSDK.S3` install cost.

## Install

```bash
dotnet add package SmooAI.File.S3
```

(Also brings in `SmooAI.File`.)

## Quick start

```csharp
using Amazon.S3;
using SmooAI.File;
using SmooAI.File.S3;

var s3 = new AmazonS3Client();

// Load an S3 object as a SmooFile — magic-byte MIME detection still applies
var file = await S3SmooFile.CreateFromS3Async(s3, "my-bucket", "uploads/foo.bin");
file.Validate(allowedMimes: new[] { "image/png", "image/jpeg", "application/pdf" });

// Upload a SmooFile to S3
await file.UploadToS3Async(s3, "my-bucket", "destination/key");

// Save an S3 object directly to a local path
await S3SmooFile.SaveFromS3ToFileAsync(s3, "my-bucket", "uploads/foo.bin", "/tmp/foo.bin");
```

## Presigned uploads

Let the browser `PUT` directly to S3 — your API never touches the bytes:

```csharp
var uploadUrl = await S3SmooFile.CreatePresignedUploadUrlAsync(s3, new()
{
    Bucket      = "my-bucket",
    Key         = $"avatars/{userId}.png",
    ContentType = "image/png",
    ExpiresIn   = TimeSpan.FromMinutes(10),
    MaxSize     = 2 * 1024 * 1024,   // enforced by signed policy
});

// Return uploadUrl to the client; they PUT the file straight to S3.
```

After the client uploads, pull it back through `SmooFile` to magic-byte-verify the content before using it:

```csharp
var uploaded = await S3SmooFile.CreateFromS3Async(s3, "my-bucket", $"avatars/{userId}.png");
uploaded.Validate(
    maxSize:          2 * 1024 * 1024,
    allowedMimes:     new[] { "image/png", "image/jpeg" },
    expectedMimeType: "image/png");
```

## Related

- [`SmooAI.File`](https://www.nuget.org/packages/SmooAI.File) — base package, required
- [`@smooai/file`](https://www.npmjs.com/package/@smooai/file) — TypeScript / Node
- [`smooai-file`](https://crates.io/crates/smooai-file) — Rust

## License

MIT — © SmooAI
