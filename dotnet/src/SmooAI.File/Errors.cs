using System.Collections.Generic;

namespace SmooAI.File;

/// <summary>
/// Base class for all file validation errors. Consumers can catch
/// <see cref="FileValidationException"/> to uniformly map validation failures
/// to an HTTP 400 or similar boundary response without parsing messages.
/// </summary>
public class FileValidationException : System.Exception
{
    public FileValidationException(string message) : base(message) { }
}

/// <summary>
/// Thrown when a file exceeds the declared <c>MaxSizeBytes</c> during validation.
/// </summary>
public sealed class FileSizeException : FileValidationException
{
    public long? ActualSize { get; }
    public long MaxSize { get; }

    public FileSizeException(long? actualSize, long maxSize)
        : base(actualSize is null
            ? $"File size is unknown; maxSize is {maxSize} bytes"
            : $"File size ({actualSize} bytes) exceeds maximum allowed ({maxSize} bytes)")
    {
        ActualSize = actualSize;
        MaxSize = maxSize;
    }
}

/// <summary>
/// Thrown when a file's MIME type is not in the declared <c>AllowedMimeTypes</c> list.
/// </summary>
public sealed class FileMimeException : FileValidationException
{
    public string? ActualMimeType { get; }
    public IReadOnlyList<string> AllowedMimeTypes { get; }

    public FileMimeException(string? actualMimeType, IReadOnlyList<string> allowedMimeTypes)
        : base(actualMimeType is null
            ? $"File mime type is unknown; allowed types are: {string.Join(", ", allowedMimeTypes)}"
            : $"File mime type \"{actualMimeType}\" is not in the allowed list: {string.Join(", ", allowedMimeTypes)}")
    {
        ActualMimeType = actualMimeType;
        AllowedMimeTypes = allowedMimeTypes;
    }
}

/// <summary>
/// Thrown when the magic-byte-detected MIME type does not match the MIME type
/// claimed by the source (e.g. a <c>.php</c> file uploaded with
/// <c>Content-Type: image/png</c>). This is the primary defense against
/// MIME-spoofing attacks for user uploads.
/// </summary>
public sealed class FileContentMismatchException : FileValidationException
{
    public string? ClaimedMimeType { get; }
    public string? DetectedMimeType { get; }

    public FileContentMismatchException(string? claimedMimeType, string? detectedMimeType)
        : base($"File content does not match claimed mime type. Claimed: {claimedMimeType ?? "unknown"}, detected: {detectedMimeType ?? "unknown"}")
    {
        ClaimedMimeType = claimedMimeType;
        DetectedMimeType = detectedMimeType;
    }
}
