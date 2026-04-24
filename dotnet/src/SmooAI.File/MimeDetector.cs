using System;
using System.IO;
using System.Linq;
using MimeDetective;
using MimeDetective.Definitions;
using MimeDetective.Definitions.Licensing;

namespace SmooAI.File;

/// <summary>
/// Result of a magic-byte MIME detection attempt.
/// </summary>
public readonly record struct MimeDetectionResult(string? MimeType, string? Extension);

/// <summary>
/// Thin wrapper around Mime-Detective that inspects byte content and returns a
/// lowercased MIME type + extension. Inspecting magic bytes is far more
/// reliable than trusting filename extensions, which is why this is the
/// primary source of truth for <see cref="SmooFile.MimeType"/>.
/// </summary>
public static class MimeDetector
{
    private static readonly Lazy<IContentInspector> Inspector = new(() =>
        new ContentInspectorBuilder
        {
            Definitions = new ExhaustiveBuilder { UsageType = UsageType.PersonalNonCommercial }.Build(),
        }.Build());

    /// <summary>
    /// Inspect a byte buffer and return the highest-confidence MIME/extension match.
    /// Returns an empty result if Mime-Detective has no signature match.
    /// </summary>
    public static MimeDetectionResult Detect(ReadOnlySpan<byte> bytes)
    {
        if (bytes.IsEmpty) return default;
        // MimeDetective's Inspect takes byte[] or ImmutableArray; copy is cheap for small prefixes.
        var buffer = bytes.ToArray();
        var results = Inspector.Value.Inspect(buffer);
        return Pick(results);
    }

    /// <summary>
    /// Inspect a stream (reading only the prefix Mime-Detective needs) and return
    /// the highest-confidence match. The stream's position is restored to its
    /// starting offset if it is seekable; otherwise callers should pass a
    /// buffered stream.
    /// </summary>
    public static MimeDetectionResult Detect(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);
        // resetPosition=true asks Mime-Detective to rewind the stream after reading its prefix,
        // so callers can continue consuming content from the original position.
        var results = Inspector.Value.Inspect(stream, resetPosition: stream.CanSeek);
        return Pick(results);
    }

    private static MimeDetectionResult Pick(System.Collections.Immutable.ImmutableArray<MimeDetective.Engine.DefinitionMatch> results)
    {
        if (results.IsDefaultOrEmpty) return default;

        string? mime = results.ByMimeType().OrderByDescending(r => r.Points).FirstOrDefault()?.MimeType;
        string? ext = results.ByFileExtension().OrderByDescending(r => r.Points).FirstOrDefault()?.Extension;

        return new MimeDetectionResult(mime?.ToLowerInvariant(), ext?.ToLowerInvariant());
    }
}
