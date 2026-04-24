using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Amazon.S3;
using Amazon.S3.Model;
using Moq;
using SmooAI.File;
using SmooAI.File.S3;
using Xunit;

namespace SmooAI.File.S3.Tests;

public class S3SmooFileTests
{
    // Minimal PNG fixture — same bytes used by the core tests.
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==");

    [Fact]
    public async Task CreateFromS3Async_DownloadsAndWrapsAsSmooFile()
    {
        var s3 = new Mock<IAmazonS3>(MockBehavior.Strict);
        s3.Setup(x => x.GetObjectAsync("bucket", "key.png", It.IsAny<CancellationToken>()))
          .ReturnsAsync(() => new GetObjectResponse
          {
              ResponseStream = new MemoryStream(Png),
              ContentLength = Png.LongLength,
              Headers = { ContentType = "image/png" },
              ETag = "\"abc123\"",
              LastModified = new DateTime(2026, 4, 23, 0, 0, 0, DateTimeKind.Utc),
          });

        var file = await S3SmooFile.CreateFromS3Async(s3.Object, "bucket", "key.png");

        Assert.Equal(FileSource.S3, file.Source);
        Assert.Equal("image/png", file.MimeType);
        Assert.Equal("s3://bucket/key.png", file.Url);
        Assert.Equal("key.png", file.Name);
        Assert.Equal("abc123", file.Hash);
        Assert.NotNull(file.LastModified);
    }

    [Fact]
    public async Task CreatePresignedUploadUrlAsync_PassesBucketKeyAndExpiresToSdk()
    {
        var s3 = new Mock<IAmazonS3>(MockBehavior.Strict);
        GetPreSignedUrlRequest? captured = null;
        s3.Setup(x => x.GetPreSignedURLAsync(It.IsAny<GetPreSignedUrlRequest>()))
          .Callback<GetPreSignedUrlRequest>(r => captured = r)
          .ReturnsAsync("https://s3.example/bucket/key?X-Amz-Signature=fake");

        var url = await S3SmooFile.CreatePresignedUploadUrlAsync(s3.Object, new S3SmooFile.PresignedUploadOptions
        {
            Bucket = "bucket",
            Key = "uploads/file.png",
            ContentType = "image/png",
            ExpiresIn = TimeSpan.FromMinutes(5),
        });

        Assert.StartsWith("https://s3.example/", url);
        Assert.NotNull(captured);
        Assert.Equal("bucket", captured!.BucketName);
        Assert.Equal("uploads/file.png", captured.Key);
        Assert.Equal(HttpVerb.PUT, captured.Verb);
        Assert.Equal("image/png", captured.ContentType);
    }

    [Fact]
    public async Task CreatePresignedDownloadUrlAsync_UsesGetVerb()
    {
        var s3 = new Mock<IAmazonS3>(MockBehavior.Strict);
        GetPreSignedUrlRequest? captured = null;
        s3.Setup(x => x.GetPreSignedURLAsync(It.IsAny<GetPreSignedUrlRequest>()))
          .Callback<GetPreSignedUrlRequest>(r => captured = r)
          .ReturnsAsync("https://s3.example/get");

        _ = await S3SmooFile.CreatePresignedDownloadUrlAsync(s3.Object, "b", "k");

        Assert.Equal(HttpVerb.GET, captured!.Verb);
    }

    [Fact]
    public async Task UploadToS3Async_ForwardsContentTypeAndName()
    {
        var s3 = new Mock<IAmazonS3>(MockBehavior.Strict);
        PutObjectRequest? captured = null;
        s3.Setup(x => x.PutObjectAsync(It.IsAny<PutObjectRequest>(), It.IsAny<CancellationToken>()))
          .Callback<PutObjectRequest, CancellationToken>((r, _) => captured = r)
          .ReturnsAsync(new PutObjectResponse());

        var file = await SmooFile.CreateFromBytesAsync(Png, o => o.Name = "tiny.png");
        await file.UploadToS3Async(s3.Object, "bucket", "dest.png");

        Assert.NotNull(captured);
        Assert.Equal("bucket", captured!.BucketName);
        Assert.Equal("dest.png", captured.Key);
        Assert.Equal("image/png", captured.ContentType);
        Assert.Contains("tiny.png", captured.Headers.ContentDisposition);
    }
}
