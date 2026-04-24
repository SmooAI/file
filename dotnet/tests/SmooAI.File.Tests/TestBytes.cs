using System;

namespace SmooAI.File.Tests;

/// <summary>
/// Known-good magic-byte fixtures so tests exercise the real Mime-Detective
/// code path rather than a stub.
/// </summary>
internal static class TestBytes
{
    // Minimal valid PNG (70 bytes)
    public static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==");

    // Minimal PDF header
    public static readonly byte[] Pdf = System.Text.Encoding.ASCII.GetBytes("%PDF-1.5\n%\xFF\xFF\xFF\xFF\n1 0 obj\n<<>>\nendobj\n");

    // Minimal JPEG (SOI + APP0 header)
    public static readonly byte[] Jpeg = new byte[]
    {
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    };

    // ZIP local file header (empty zip)
    public static readonly byte[] Zip = new byte[]
    {
        0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    };
}
