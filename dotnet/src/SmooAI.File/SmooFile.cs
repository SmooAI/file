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

    // ---- Lazy streaming state -----------------------------------------------
    // When _lazy is true, _bytes contains only the magic-byte-detection head
    // buffer (~64 KB). The tail of the source is still in _lazyTail and is
    // drained chunk-by-chunk by ReadBytesAsync(), OpenReadStream(), or the
    // S3 upload helper — so a 2 GB upload doesn't have to fit in RAM.
    private bool _lazy;
    private Stream? _lazyTail;

    /// <summary>
    /// Head buffer read up-front when constructing a lazy stream. 64 KB is
    /// enough for every MIME detector we support; the rest of the source stays
    /// un-buffered until the consumer asks for it.
    /// </summary>
    internal const int LazyHeadBytes = 64 * 1024;

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

    private SmooFile(FileSource source, byte[] head, Stream tail, FileMetadata metadata, MimeDetectionResult detected)
    {
        Source = source;
        _bytes = head;
        _lazy = true;
        _lazyTail = tail;
        Metadata = metadata;
        Detected = detected;
    }

    /// <summary>
    /// Whether this file is in lazy-streaming mode. When true, the tail of the
    /// source stream is still un-buffered and will be drained on the next
    /// <see cref="ReadBytesAsync"/>, <see cref="OpenReadStream"/>, or upload
    /// call. Mostly useful for tests; consumers shouldn't need to branch on it.
    /// </summary>
    public bool IsLazy => _lazy;

    /// <summary>
    /// Read raw bytes. Returned array is a defensive copy. For lazy streams
    /// this drains the remaining tail into memory and caches it — subsequent
    /// calls return the cached buffer. Use <see cref="OpenReadStream"/> when
    /// you don't want the full payload in RAM at once.
    /// </summary>
    public async Task<byte[]> ReadBytesAsync(CancellationToken ct = default)
    {
        await DrainLazyTailAsync(ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        var copy = new byte[_bytes.Length];
        Buffer.BlockCopy(_bytes, 0, copy, 0, _bytes.Length);
        return copy;
    }

    /// <summary>
    /// Open a forward-only stream that yields the file contents chunk-by-chunk
    /// without buffering the whole payload. For lazy streams this returns a
    /// concatenated view of the head buffer + the remaining tail, so peak
    /// memory stays bounded to a single chunk during a copy.
    ///
    /// Reading from the returned stream consumes the lazy tail. After the
    /// stream is fully read, subsequent <see cref="ReadBytesAsync"/> or
    /// <see cref="OpenReadStream"/> calls will see an exhausted source.
    /// </summary>
    public Stream OpenReadStream()
    {
        if (_lazy && _lazyTail is not null)
        {
            // Hand off the head + tail to a single read-once stream. Mark this
            // SmooFile as no-longer-lazy and clear our tail reference so a
            // second OpenReadStream/ReadBytesAsync call sees the cached head
            // (now empty after the stream drains) rather than re-yielding it.
            var head = _bytes;
            var tail = _lazyTail;
            _bytes = Array.Empty<byte>();
            _lazyTail = null;
            _lazy = false;
            return new HeadAndTailStream(head, tail, sizeUpdate: size =>
            {
                Metadata.Size = size;
            });
        }
        return new MemoryStream(_bytes, writable: false);
    }

    /// <summary>
    /// Drain a lazy stream's tail into _bytes. Idempotent for non-lazy files.
    /// </summary>
    private async Task DrainLazyTailAsync(CancellationToken ct)
    {
        if (!_lazy || _lazyTail is null) return;

        using var ms = new MemoryStream();
        ms.Write(_bytes, 0, _bytes.Length);
        await _lazyTail.CopyToAsync(ms, ct).ConfigureAwait(false);
        _bytes = ms.ToArray();
        _lazyTail.Dispose();
        _lazyTail = null;
        _lazy = false;
        Metadata.Size = _bytes.LongLength;
    }

    /// <summary>
    /// Read the content as a UTF-8 string.
    /// </summary>
    public async Task<string> ReadStringAsync(CancellationToken ct = default)
    {
        await DrainLazyTailAsync(ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        return System.Text.Encoding.UTF8.GetString(_bytes);
    }

    /// <summary>
    /// Base64-encode the content. Useful for email attachments, data URLs, and
    /// APIs that require inline-encoded file bytes.
    /// </summary>
    public async Task<string> ToBase64Async(CancellationToken ct = default)
    {
        await DrainLazyTailAsync(ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        return Convert.ToBase64String(_bytes);
    }

    /// <summary>
    /// Copy the file contents to a destination stream. Useful for serving
    /// responses or staging uploads. For lazy streams this streams head + tail
    /// through the destination so peak memory stays bounded.
    /// </summary>
    public async Task CopyToAsync(Stream destination, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(destination);
        if (_lazy && _lazyTail is not null)
        {
            await using var view = OpenReadStream();
            await view.CopyToAsync(destination, ct).ConfigureAwait(false);
            return;
        }
        await destination.WriteAsync(_bytes.AsMemory(), ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Compute the SHA-256 hex digest of the file contents.
    /// </summary>
    public async Task<string> GetChecksumAsync(CancellationToken ct = default)
    {
        await DrainLazyTailAsync(ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        var hash = SHA256.HashData(_bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Save the file to a path on disk. For lazy streams this streams the
    /// content directly to disk without buffering it in memory.
    /// </summary>
    public async Task SaveToFileAsync(string destinationPath, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(destinationPath);
        if (_lazy && _lazyTail is not null)
        {
            await using var dest = System.IO.File.Create(destinationPath);
            await CopyToAsync(dest, ct).ConfigureAwait(false);
            return;
        }
        await System.IO.File.WriteAllBytesAsync(destinationPath, _bytes, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Build a <see cref="MultipartFormDataContent"/> ready to send via
    /// <see cref="HttpClient"/>. The TS port exposes the same helper for
    /// relay/proxy scenarios. The form contains a single field named
    /// <paramref name="attrName"/> carrying the file bytes, filename, and
    /// content-type.
    /// </summary>
    /// <param name="attrName">Form field name. Defaults to <c>"file"</c> to match the TS API.</param>
    public MultipartFormDataContent ToFormData(string attrName = "file")
    {
        if (string.IsNullOrEmpty(attrName)) attrName = "file";
        var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(_bytes);
        var mime = MimeType ?? "application/octet-stream";
        content.Headers.ContentType = new MediaTypeHeaderValue(mime);
        // MultipartFormDataContent.Add(..., name, fileName) rejects null/empty
        // filenames; fall back to the field name so missing-Name files still
        // round-trip as a valid multipart payload.
        var fileName = string.IsNullOrWhiteSpace(Name) ? attrName : Name!;
        form.Add(content, attrName, fileName);
        return form;
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
    /// Create a <see cref="SmooFile"/> from a stream. By default the entire
    /// stream is buffered into memory so the content can be revalidated,
    /// hashed, copied, and encoded without re-reading from the source.
    ///
    /// Pass <paramref name="lazy"/> = <c>true</c> to keep the tail un-buffered
    /// — only the first ~64 KB is read up-front for magic-byte detection, and
    /// the rest stays in the source stream until consumed by
    /// <see cref="ReadBytesAsync"/>, <see cref="OpenReadStream"/>, or
    /// <c>S3SmooFile.UploadToS3Async</c>. This is the path that lets a 2 GB
    /// upload through a memory-constrained process.
    /// </summary>
    public static async Task<SmooFile> CreateFromStreamAsync(Stream stream, Action<SmooFileOptions>? configure = null, CancellationToken ct = default, bool lazy = false)
    {
        ArgumentNullException.ThrowIfNull(stream);
        var options = new SmooFileOptions();
        configure?.Invoke(options);

        if (lazy)
        {
            return await BuildLazyFromStreamAsync(FileSource.Stream, stream, options, ct).ConfigureAwait(false);
        }

        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms, ct).ConfigureAwait(false);
        var bytes = ms.ToArray();
        return BuildFromBytes(FileSource.Stream, bytes, options);
    }

    /// <summary>
    /// Convenience overload that mirrors Python's <c>from_stream(lazy=True)</c>.
    /// Behaviour is identical to <see cref="CreateFromStreamAsync"/> with
    /// <c>lazy: true</c>.
    /// </summary>
    public static Task<SmooFile> CreateFromStreamLazyAsync(Stream stream, Action<SmooFileOptions>? configure = null, CancellationToken ct = default)
        => CreateFromStreamAsync(stream, configure, ct, lazy: true);

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
    /// Create a <see cref="SmooFile"/> from an ASP.NET Core <c>IFormFile</c>-style
    /// upload. Rather than referencing <c>Microsoft.AspNetCore.Http</c> directly
    /// (which would force the dep on every consumer), this overload takes the
    /// three fields <c>IFormFile</c> exposes — call site looks like:
    /// <code>
    /// await SmooFile.CreateFromFormFileAsync(formFile.OpenReadStream(), formFile.FileName, formFile.ContentType);
    /// </code>
    /// Mirrors TS's <c>createFromWebFile</c>.
    /// </summary>
    public static async Task<SmooFile> CreateFromFormFileAsync(
        Stream stream,
        string? fileName = null,
        string? contentType = null,
        Action<SmooFileOptions>? configure = null,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(stream);
        var options = new SmooFileOptions
        {
            Name = string.IsNullOrEmpty(fileName) ? null : fileName,
            MimeType = string.IsNullOrEmpty(contentType) ? null : contentType,
        };
        configure?.Invoke(options);

        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms, ct).ConfigureAwait(false);
        var bytes = ms.ToArray();
        return BuildFromBytes(FileSource.Stream, bytes, options);
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

        options.Name ??= ContentDisposition.ExtractFilename(response.Content.Headers.ContentDisposition)
            ?? ContentDisposition.ExtractFilename(GetRawContentDisposition(response))
            ?? FilenameFromUrl(url);
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

    /// <summary>
    /// Build a lazy SmooFile from a stream. Reads up to <see cref="LazyHeadBytes"/>
    /// for magic-byte detection, keeps the rest of the stream un-buffered. If
    /// the source is shorter than the head buffer, falls back to the eager
    /// path so size/cached-buffer semantics match a non-lazy construction.
    /// </summary>
    internal static async Task<SmooFile> BuildLazyFromStreamAsync(FileSource source, Stream stream, SmooFileOptions options, CancellationToken ct)
    {
        // Read up to LazyHeadBytes into the head buffer.
        var head = new byte[LazyHeadBytes];
        int total = 0;
        while (total < head.Length)
        {
            int read = await stream.ReadAsync(head.AsMemory(total, head.Length - total), ct).ConfigureAwait(false);
            if (read == 0) break;
            total += read;
        }

        if (total < head.Length)
        {
            // Source exhausted during head-read — promote to eager path.
            Array.Resize(ref head, total);
            return BuildFromBytes(source, head, options);
        }

        // Lazy path: head holds first LazyHeadBytes, stream holds the rest.
        var detected = MimeDetector.Detect(head);
        var metadata = options.ToMetadataHint();
        // Size is unknown until the tail is drained — leave whatever the caller
        // hinted, or null. Magic-byte detection still wins for MIME/extension.
        metadata.MimeType = detected.MimeType ?? metadata.MimeType ?? ExtensionMimeMap.MimeFromName(metadata.Name);
        metadata.Extension = detected.Extension ?? metadata.Extension ?? ExtractExtension(metadata.Name) ?? ExtensionMimeMap.ExtensionFromMime(metadata.MimeType);

        return new SmooFile(source, head, stream, metadata, detected);
    }

    private static string? ExtractExtension(string? name)
    {
        if (string.IsNullOrEmpty(name)) return null;
        var ext = System.IO.Path.GetExtension(name);
        return string.IsNullOrEmpty(ext) ? null : ext.TrimStart('.').ToLowerInvariant();
    }

    private static string? GetRawContentDisposition(HttpResponseMessage response)
    {
        if (response.Content.Headers.TryGetValues("Content-Disposition", out var values))
        {
            foreach (var v in values)
                if (!string.IsNullOrEmpty(v)) return v;
        }
        return null;
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

/// <summary>
/// A read-only forward-only Stream that first yields a head buffer, then
/// transparently transitions to reading from a tail Stream. Used by
/// <see cref="SmooFile.OpenReadStream"/> so consumers see one logical stream
/// even though the file's bytes live in two places (the detection head + the
/// un-buffered source).
/// </summary>
internal sealed class HeadAndTailStream : Stream
{
    private readonly byte[] _head;
    private int _headPos;
    private Stream? _tail;
    private long _totalRead;
    private readonly Action<long>? _onClose;

    public HeadAndTailStream(byte[] head, Stream tail, Action<long>? sizeUpdate = null)
    {
        _head = head;
        _tail = tail;
        _onClose = sizeUpdate;
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => _totalRead;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        if (_headPos < _head.Length)
        {
            int n = Math.Min(count, _head.Length - _headPos);
            Buffer.BlockCopy(_head, _headPos, buffer, offset, n);
            _headPos += n;
            _totalRead += n;
            return n;
        }
        if (_tail is null) return 0;
        int read = _tail.Read(buffer, offset, count);
        _totalRead += read;
        return read;
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        if (_headPos < _head.Length)
        {
            int n = Math.Min(buffer.Length, _head.Length - _headPos);
            _head.AsMemory(_headPos, n).CopyTo(buffer);
            _headPos += n;
            _totalRead += n;
            return n;
        }
        if (_tail is null) return 0;
        int read = await _tail.ReadAsync(buffer, ct).ConfigureAwait(false);
        _totalRead += read;
        return read;
    }

    public override void Flush() { }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _onClose?.Invoke(_totalRead);
            _tail?.Dispose();
            _tail = null;
        }
        base.Dispose(disposing);
    }
}
