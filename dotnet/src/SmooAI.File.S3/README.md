# SmooAI.File.S3

S3 helpers for [`SmooAI.File`](https://www.nuget.org/packages/SmooAI.File).
Kept in a separate package so apps that only need MIME detection and
validation don't pull in the AWS SDK.

## Install

```bash
dotnet add package SmooAI.File.S3
```

## Usage

```csharp
using Amazon.S3;
using SmooAI.File;
using SmooAI.File.S3;

var s3 = new AmazonS3Client();

// Load an S3 object as a SmooFile (magic-byte MIME detection still applies).
var file = await S3SmooFile.CreateFromS3Async(s3, "my-bucket", "uploads/foo.bin");

// Generate a presigned URL so a client can PUT directly to S3.
var uploadUrl = await S3SmooFile.CreatePresignedUploadUrlAsync(s3, new()
{
    Bucket = "my-bucket",
    Key = $"avatars/{userId}.png",
    ContentType = "image/png",
    ExpiresIn = TimeSpan.FromMinutes(10),
    MaxSize = 2 * 1024 * 1024,
});

// Upload a SmooFile to S3.
await file.UploadToS3Async(s3, "my-bucket", "destination/key");
```

## License

MIT
