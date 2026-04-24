using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace SmooAI.File;

/// <summary>
/// Options that can be applied during file creation or supplied as hints for
/// sources that don't expose full metadata (e.g. a raw byte buffer).
/// </summary>
public sealed class SmooFileOptions
{
    public string? Name { get; set; }
    public string? MimeType { get; set; }
    public long? Size { get; set; }
    public string? Extension { get; set; }
    public string? Url { get; set; }
    public string? Path { get; set; }
    public string? Hash { get; set; }
    public DateTimeOffset? LastModified { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }

    /// <summary>
    /// When provided, <see cref="SmooFile.Validate"/> will enforce an allowlist.
    /// Callers can also pass allowed types directly to <see cref="SmooFile.Validate"/>.
    /// </summary>
    public IReadOnlyList<string>? AllowedMimeTypes { get; set; }

    /// <summary>
    /// When provided, <see cref="SmooFile.Validate"/> will reject files larger than this.
    /// </summary>
    public long? MaxSizeBytes { get; set; }

    /// <summary>
    /// The MIME type the caller (e.g. client upload) <i>claims</i> the file is.
    /// Compared against the magic-byte-detected MIME type; disagreement throws
    /// <see cref="FileContentMismatchException"/>.
    /// </summary>
    public string? ExpectedMimeType { get; set; }

    internal FileMetadata ToMetadataHint() => new()
    {
        Name = Name,
        MimeType = MimeType,
        Size = Size,
        Extension = Extension,
        Url = Url,
        Path = Path,
        Hash = Hash,
        LastModified = LastModified,
        CreatedAt = CreatedAt,
    };
}

/// <summary>
/// Validation rules passed explicitly to <see cref="SmooFile.ValidateAsync"/>.
/// </summary>
public sealed class ValidateOptions
{
    public long? MaxSize { get; set; }
    public IReadOnlyList<string>? AllowedMimes { get; set; }
    public string? ExpectedMimeType { get; set; }
}

/// <summary>
/// A file wrapper that captures content, detected MIME type, size, and other
/// metadata, and exposes helpers for reading, validation, base64 encoding, and
/// checksumming. Magic-byte detection via <see cref="MimeDetector"/> is the
/// primary source of truth for <see cref="MimeType"/>, which makes validation
/// resistant to MIME spoofing.
/// </summary>
public sealed class SmooFile
{
    private byte[] _bytes;

    /// <summary>Where this file was originally loaded from.</summary>
    public FileSource Source { get; }

    /// <summary>Full metadata. Individual getters expose the common fields.</summary>
    public FileMetadata Metadata { get; }

    /// <summary>Result of magic-byte inspection, separate from <see cref="MimeType"/> which may include hints.</summary>
    public MimeDetectionResult Detected { get; }

    public string? Name => Metadata.Name;
    public string? MimeType => Metadata.MimeType;
    public long? Size => Metadata.Size;
    public string? Extension => Metadata.Extension;
    public string? Url => Metadata.Url;
    public string? Path => Metadata.Path;
    public string? Hash => Metadata.Hash;
    public DateTimeOffset? LastModified => Metadata.LastModified;
    public DateTimeOffset? CreatedAt => Metadata.CreatedAt;

    internal SmooFile(FileSource source, byte[] bytes, FileMetadata metadata, MimeDetectionResult detected)
    {
        Source = source;
        _bytes = bytes;
        Metadata = metadata;
        Detected = detected;
    }

    /// <summary>
    /// Read raw bytes. Returned array is a defensive copy.
    /// </summary>
    public Task<byte[]> ReadBytesAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var copy = new byte[_bytes.Length];
        Buffer.BlockCopy(_bytes, 0, copy, 0, _bytes.Length);
        return Task.FromResult(copy);
    }

    /// <summary>
    /// Read the content as a UTF-8 string.
    /// </summary>
    public Task<string> ReadStringAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(System.Text.Encoding.UTF8.GetString(_bytes));
    }

    /// <summary>
    /// Base64-encode the content. Useful for email attachments, data URLs, and
    /// APIs that require inline-encoded file bytes.
    /// </summary>
    public Task<string> ToBase64Async(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(Convert.ToBase64String(_bytes));
    }

    /// <summary>
    /// Copy the file contents to a destination stream. Useful for serving
    /// responses or staging uploads.
    /// </summary>
    public async Task CopyToAsync(Stream destination, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(destination);
        await destination.WriteAsync(_bytes.AsMemory(), ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Compute the SHA-256 hex digest of the file contents.
    /// </summary>
    public Task<string> GetChecksumAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var hash = SHA256.HashData(_bytes);
        return Task.FromResult(Convert.ToHexString(hash).ToLowerInvariant());
    }

    /// <summary>
    /// Save the file to a path on disk.
    /// </summary>
    public async Task SaveToFileAsync(string destinationPath, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(destinationPath);
        await System.IO.File.WriteAllBytesAsync(destinationPath, _bytes, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Validate size, MIME allowlist, and (optionally) that the claimed content
    /// type agrees with the magic-byte-detected type. Throws a typed
    /// <see cref="FileValidationException"/> on failure so callers (e.g. HTTP
    /// routes) can cleanly map to a 400 without parsing messages.
    /// </summary>
    public Task ValidateAsync(ValidateOptions options, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        ct.ThrowIfCancellationRequested();
        Validate(options.MaxSize, options.AllowedMimes, options.ExpectedMimeType);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Synchronous overload of <see cref="ValidateAsync"/>.
    /// </summary>
    public void Validate(long? maxSize = null, IReadOnlyList<string>? allowedMimes = null, string? expectedMimeType = null)
    {
        if (maxSize is long max)
        {
            var size = Metadata.Size;
            if (size is null || size > max)
                throw new FileSizeException(size, max);
        }

        if (allowedMimes is { Count: > 0 })
        {
            var mime = Metadata.MimeType;
            if (mime is null || !allowedMimes.Any(m => string.Equals(m, mime, StringComparison.OrdinalIgnoreCase)))
                throw new FileMimeException(mime, allowedMimes);
        }

        if (expectedMimeType is not null)
        {
            // Disagreement between client-claimed and magic-byte-detected type is
            // the primary defense against MIME spoofing (e.g. a .php posted as image/png).
            var detected = Detected.MimeType;
            if (detected is null || !string.Equals(detected, expectedMimeType, StringComparison.OrdinalIgnoreCase))
                throw new FileContentMismatchException(expectedMimeType, detected);
        }
    }

    // ---- Factories ----------------------------------------------------------

    /// <summary>
    /// Create a <see cref="SmooFile"/> from a byte array. Pass metadata hints
    /// for fields Mime-Detective can't infer (original filename, URL).
    /// </summary>
    public static Task<SmooFile> CreateFromBytesAsync(byte[] bytes, Action<SmooFileOptions>? configure = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        ct.ThrowIfCancellationRequested();
        var options = new SmooFileOptions();
        configure?.Invoke(options);
        return Task.FromResult(BuildFromBytes(FileSource.Bytes, bytes, options));
    }

    /// <summary>
    /// Create a <see cref="SmooFile"/> from a stream. The entire stream is
    /// buffered into memory so the content can be revalidated, hashed, copied,
    /// and encoded without re-reading from the source.
    /// </summary>
    public static async Task<SmooFile> CreateFromStreamAsync(Stream stream, Action<SmooFileOptions>? configure = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(stream);
        var options = new SmooFileOptions();
        configure?.Invoke(options);

        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms, ct).ConfigureAwait(false);
        var bytes = ms.ToArray();
        return BuildFromBytes(FileSource.Stream, bytes, options);
    }

    /// <summary>
    /// Create a <see cref="SmooFile"/> from a local path.
    /// </summary>
    public static async Task<SmooFile> CreateFromFileAsync(string path, Action<SmooFileOptions>? configure = null, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        var options = new SmooFileOptions();
        configure?.Invoke(options);

        var bytes = await System.IO.File.ReadAllBytesAsync(path, ct).ConfigureAwait(false);

        var info = new FileInfo(path);
        options.Path ??= path;
        options.Name ??= info.Name;
        options.LastModified ??= info.LastWriteTimeUtc;
        options.CreatedAt ??= info.CreationTimeUtc;
        return BuildFromBytes(FileSource.File, bytes, options);
    }

    /// <summary>
    /// Download a URL and create a <see cref="SmooFile"/> from the response body.
    /// Optionally pass an <see cref="HttpClient"/>; otherwise a shared one is used.
    /// </summary>
    public static async Task<SmooFile> CreateFromUrlAsync(string url, HttpClient? httpClient = null, Action<SmooFileOptions>? configure = null, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(url);
        var options = new SmooFileOptions { Url = url };
        configure?.Invoke(options);

        var client = httpClient ?? SharedHttpClient.Instance;
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        options.Name ??= ParseFilename(response.Content.Headers.ContentDisposition) ?? FilenameFromUrl(url);
        options.MimeType ??= response.Content.Headers.ContentType?.MediaType;
        options.Size ??= response.Content.Headers.ContentLength;
        options.LastModified ??= response.Content.Headers.LastModified;
        if (response.Headers.ETag is EntityTagHeaderValue etag)
            options.Hash ??= etag.Tag?.Trim('"');

        var bytes = await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        return BuildFromBytes(FileSource.Url, bytes, options);
    }

    // ---- Presigned URL helpers -------------------------------------------------
    // S3-specific factories live in the SmooAI.File.S3 sub-package to keep the
    // core lean. See SmooAI.File.S3.S3SmooFile for CreateFromS3Async,
    // CreatePresignedUploadUrlAsync, UploadToS3Async, etc.

    // ---- Internals -------------------------------------------------------------

    internal static SmooFile BuildFromBytes(FileSource source, byte[] bytes, SmooFileOptions options)
    {
        var detected = MimeDetector.Detect(bytes);

        var metadata = options.ToMetadataHint();
        metadata.Size ??= bytes.LongLength;

        // Magic-byte detection wins over extension and caller hints — it's the
        // defensive choice because file extensions lie.
        metadata.MimeType = detected.MimeType ?? metadata.MimeType ?? ExtensionMimeMap.MimeFromName(metadata.Name);
        metadata.Extension = detected.Extension ?? metadata.Extension ?? ExtractExtension(metadata.Name) ?? ExtensionMimeMap.ExtensionFromMime(metadata.MimeType);

        return new SmooFile(source, bytes, metadata, detected);
    }

    private static string? ExtractExtension(string? name)
    {
        if (string.IsNullOrEmpty(name)) return null;
        var ext = System.IO.Path.GetExtension(name);
        return string.IsNullOrEmpty(ext) ? null : ext.TrimStart('.').ToLowerInvariant();
    }

    private static string? ParseFilename(ContentDispositionHeaderValue? disposition)
    {
        if (disposition is null) return null;
        return disposition.FileNameStar?.Trim('"') ?? disposition.FileName?.Trim('"');
    }

    private static string? FilenameFromUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
        var name = System.IO.Path.GetFileName(WebUtility.UrlDecode(uri.AbsolutePath));
        return string.IsNullOrEmpty(name) ? null : name;
    }
}

internal static class SharedHttpClient
{
    public static readonly HttpClient Instance = new();
}
