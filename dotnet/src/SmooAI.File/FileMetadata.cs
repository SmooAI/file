using System;

namespace SmooAI.File;

/// <summary>
/// Represents metadata about a file including its properties and attributes.
/// All fields are optional because sources vary in what information they expose.
/// </summary>
public sealed class FileMetadata
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

    public FileMetadata Clone() => new()
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
/// Source types a <see cref="SmooFile"/> may originate from.
/// </summary>
public enum FileSource
{
    Url,
    Bytes,
    File,
    Stream,
    S3,
}
