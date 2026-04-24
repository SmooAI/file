using System;
using System.Collections.Generic;
using System.IO;

namespace SmooAI.File;

/// <summary>
/// Minimal extension→MIME lookup used only as a fallback when magic-byte
/// detection returns nothing. Kept intentionally small — do not use this for
/// authoritative validation; always prefer <see cref="MimeDetector"/>.
/// </summary>
internal static class ExtensionMimeMap
{
    // Conservative set — extend only if Mime-Detective ever misses a common type.
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        ["txt"] = "text/plain",
        ["csv"] = "text/csv",
        ["json"] = "application/json",
        ["html"] = "text/html",
        ["htm"] = "text/html",
        ["xml"] = "application/xml",
        ["pdf"] = "application/pdf",
        ["png"] = "image/png",
        ["jpg"] = "image/jpeg",
        ["jpeg"] = "image/jpeg",
        ["gif"] = "image/gif",
        ["webp"] = "image/webp",
        ["svg"] = "image/svg+xml",
        ["zip"] = "application/zip",
        ["mp3"] = "audio/mpeg",
        ["mp4"] = "video/mp4",
        ["wav"] = "audio/wav",
        ["doc"] = "application/msword",
        ["docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ["xls"] = "application/vnd.ms-excel",
        ["xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    private static readonly Dictionary<string, string> ReverseMap = BuildReverse();

    private static Dictionary<string, string> BuildReverse()
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in Map)
            d.TryAdd(kv.Value, kv.Key);
        return d;
    }

    public static string? MimeFromName(string? name)
    {
        if (string.IsNullOrEmpty(name)) return null;
        var ext = Path.GetExtension(name);
        if (string.IsNullOrEmpty(ext)) return null;
        return Map.TryGetValue(ext.TrimStart('.'), out var mime) ? mime : null;
    }

    public static string? ExtensionFromMime(string? mimeType)
    {
        if (string.IsNullOrEmpty(mimeType)) return null;
        return ReverseMap.TryGetValue(mimeType, out var ext) ? ext : null;
    }
}
