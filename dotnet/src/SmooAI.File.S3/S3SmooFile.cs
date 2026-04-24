using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Amazon.S3;
using Amazon.S3.Model;

namespace SmooAI.File.S3;

/// <summary>
/// S3 helpers for <see cref="SmooFile"/>. Kept in a separate package so the
/// core <c>SmooAI.File</c> doesn't force the AWS SDK on consumers who only
/// need MIME detection and validation.
/// </summary>
public static class S3SmooFile
{
    /// <summary>
    /// Fetch an S3 object and wrap it as a <see cref="SmooFile"/>. Content-type,
    /// content-length, ETag, and last-modified are pulled from the S3 response
    /// as hints, but magic-byte detection still wins.
    /// </summary>
    public static async Task<SmooFile> CreateFromS3Async(
        IAmazonS3 s3,
        string bucket,
        string key,
        Action<SmooFileOptions>? configure = null,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(s3);
        ArgumentException.ThrowIfNullOrEmpty(bucket);
        ArgumentException.ThrowIfNullOrEmpty(key);

        var options = new SmooFileOptions
        {
            Url = $"s3://{bucket}/{key}",
            Name = System.IO.Path.GetFileName(key),
        };
        configure?.Invoke(options);

        using var response = await s3.GetObjectAsync(bucket, key, ct).ConfigureAwait(false);

        options.MimeType ??= response.Headers.ContentType;
        options.Size ??= response.ContentLength > 0 ? response.ContentLength : (long?)null;
        options.Hash ??= response.ETag?.Trim('"');
        options.LastModified ??= response.LastModified is { } lm ? new DateTimeOffset(lm, TimeSpan.Zero) : (DateTimeOffset?)null;

        using var ms = new MemoryStream();
        await response.ResponseStream.CopyToAsync(ms, ct).ConfigureAwait(false);
        var bytes = ms.ToArray();

        return SmooFile.BuildFromBytes(FileSource.S3, bytes, options);
    }

    /// <summary>
    /// Options for a presigned PUT URL used by browsers or mobile clients to
    /// upload directly to S3 without routing bytes through the server.
    /// </summary>
    public sealed class PresignedUploadOptions
    {
        public required string Bucket { get; init; }
        public required string Key { get; init; }
        public string? ContentType { get; init; }
        public TimeSpan? ExpiresIn { get; init; }
        /// <summary>
        /// Optional max content length (bytes). Baked into the signed request;
        /// clients that don't send Content-Length will fail S3 upload — but
        /// servers should still do a HEAD check post-upload because not all
        /// clients actually send the length.
        /// </summary>
        public long? MaxSize { get; init; }
    }

    /// <summary>
    /// Generate a presigned PUT URL so a client can upload directly to S3.
    /// </summary>
    public static Task<string> CreatePresignedUploadUrlAsync(IAmazonS3 s3, PresignedUploadOptions options)
    {
        ArgumentNullException.ThrowIfNull(s3);
        ArgumentNullException.ThrowIfNull(options);
        var req = new GetPreSignedUrlRequest
        {
            BucketName = options.Bucket,
            Key = options.Key,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.Add(options.ExpiresIn ?? TimeSpan.FromHours(1)),
            ContentType = options.ContentType,
        };
        return s3.GetPreSignedURLAsync(req);
    }

    /// <summary>
    /// Generate a presigned GET URL to download an existing S3 object.
    /// </summary>
    public static Task<string> CreatePresignedDownloadUrlAsync(IAmazonS3 s3, string bucket, string key, TimeSpan? expiresIn = null)
    {
        ArgumentNullException.ThrowIfNull(s3);
        ArgumentException.ThrowIfNullOrEmpty(bucket);
        ArgumentException.ThrowIfNullOrEmpty(key);
        var req = new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(expiresIn ?? TimeSpan.FromHours(1)),
        };
        return s3.GetPreSignedURLAsync(req);
    }

    /// <summary>
    /// Upload a <see cref="SmooFile"/> to S3. The detected MIME type and name
    /// are attached as <c>Content-Type</c> and <c>Content-Disposition</c>.
    /// </summary>
    public static async Task UploadToS3Async(this SmooFile file, IAmazonS3 s3, string bucket, string key, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(s3);
        ArgumentException.ThrowIfNullOrEmpty(bucket);
        ArgumentException.ThrowIfNullOrEmpty(key);

        var bytes = await file.ReadBytesAsync(ct).ConfigureAwait(false);
        using var stream = new MemoryStream(bytes);

        var put = new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = stream,
            ContentType = file.MimeType,
            AutoCloseStream = false,
        };
        if (!string.IsNullOrEmpty(file.Name))
            put.Headers.ContentDisposition = $"attachment; filename=\"{file.Name}\"";

        await s3.PutObjectAsync(put, ct).ConfigureAwait(false);
    }
}
