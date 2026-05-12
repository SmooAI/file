using System;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;

namespace SmooAI.File;

/// <summary>
/// Parsed Content-Disposition header data.
/// </summary>
public sealed class ContentDispositionData
{
    /// <summary>The disposition type (e.g. "attachment", "inline"). Lowercased.</summary>
    public string DispositionType { get; init; } = "";

    /// <summary>The resolved filename. RFC 5987 (<c>filename*</c>) takes precedence over plain <c>filename</c>.</summary>
    public string? Filename { get; init; }
}

/// <summary>
/// Content-Disposition header parsing.
///
/// Extracts the filename from HTTP Content-Disposition headers following
/// RFC 6266 / RFC 5987 patterns. Uses <see cref="ContentDispositionHeaderValue"/>
/// as the primary parser (which handles most spec-compliant cases) and falls
/// back to a manual regex parser for edge cases (e.g. spaces, mixed casing,
/// missing quotes) that the BCL parser rejects.
/// </summary>
public static class ContentDisposition
{
    private static readonly Regex FilenameRegex = new(
        @"filename\s*=\s*(?:""(?<v>[^""]*)""|(?<v>[^;]+))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex FilenameStarRegex = new(
        @"filename\*\s*=\s*(?<enc>[^']*)'[^']*'(?<v>[^;]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Parse a Content-Disposition header value. Returns <c>null</c> when the
    /// input is null, empty, or unparseable.
    /// </summary>
    public static ContentDispositionData? Parse(string? header)
    {
        if (string.IsNullOrWhiteSpace(header)) return null;

        // Primary: BCL parser (handles RFC 6266 + RFC 5987 encoded-word filenames).
        if (ContentDispositionHeaderValue.TryParse(header, out var parsed))
        {
            var filename = TryUnquote(parsed.FileNameStar) ?? TryUnquote(parsed.FileName);
            if (!string.IsNullOrEmpty(filename) || !string.IsNullOrEmpty(parsed.DispositionType))
            {
                return new ContentDispositionData
                {
                    DispositionType = (parsed.DispositionType ?? "").Trim().ToLowerInvariant(),
                    Filename = string.IsNullOrEmpty(filename) ? FallbackFilename(header) : filename,
                };
            }
        }

        // Fallback: manual regex parse for malformed headers the BCL rejects.
        var trimmed = header.Trim();
        var semi = trimmed.IndexOf(';');
        var dispositionType = (semi < 0 ? trimmed : trimmed[..semi]).Trim().ToLowerInvariant();
        var fallback = FallbackFilename(trimmed);
        if (fallback is null && string.IsNullOrEmpty(dispositionType)) return null;
        return new ContentDispositionData { DispositionType = dispositionType, Filename = fallback };
    }

    /// <summary>
    /// Extract just the filename from a Content-Disposition header. Convenience
    /// wrapper around <see cref="Parse(string)"/>.
    /// </summary>
    public static string? ExtractFilename(string? header) => Parse(header)?.Filename;

    /// <summary>
    /// Extract the filename from a parsed <see cref="ContentDispositionHeaderValue"/>.
    /// RFC 6266 says <c>filename*</c> wins over <c>filename</c>.
    /// </summary>
    public static string? ExtractFilename(ContentDispositionHeaderValue? disposition)
    {
        if (disposition is null) return null;
        return TryUnquote(disposition.FileNameStar) ?? TryUnquote(disposition.FileName);
    }

    private static string? FallbackFilename(string header)
    {
        // filename* takes precedence over filename per RFC 6266.
        var star = FilenameStarRegex.Match(header);
        if (star.Success)
        {
            var enc = star.Groups["enc"].Value.Trim();
            var raw = star.Groups["v"].Value.Trim().Trim('"');
            return DecodePercent(raw, enc);
        }

        var plain = FilenameRegex.Match(header);
        if (plain.Success)
        {
            return plain.Groups["v"].Value.Trim().Trim('"');
        }
        return null;
    }

    private static string? TryUnquote(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        var trimmed = s.Trim();
        if (trimmed.Length >= 2 && trimmed.StartsWith('"') && trimmed.EndsWith('"'))
            trimmed = trimmed[1..^1];
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static string DecodePercent(string input, string encoding)
    {
        var enc = string.IsNullOrEmpty(encoding) ? Encoding.UTF8 : SafeEncoding(encoding);
        var bytes = new System.Collections.Generic.List<byte>(input.Length);
        var span = input.AsSpan();
        for (int i = 0; i < span.Length; i++)
        {
            if (span[i] == '%' && i + 2 < span.Length &&
                byte.TryParse(span.Slice(i + 1, 2), System.Globalization.NumberStyles.HexNumber,
                    System.Globalization.CultureInfo.InvariantCulture, out var b))
            {
                bytes.Add(b);
                i += 2;
            }
            else
            {
                // Plain ASCII char from the source — encode it via the target encoding.
                foreach (var nb in enc.GetBytes(new[] { span[i] }))
                    bytes.Add(nb);
            }
        }
        return enc.GetString(bytes.ToArray());
    }

    private static Encoding SafeEncoding(string name)
    {
        try { return Encoding.GetEncoding(name); }
        catch { return Encoding.UTF8; }
    }
}
