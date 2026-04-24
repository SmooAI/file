using System.IO;
using Xunit;

namespace SmooAI.File.Tests;

public class MimeDetectorTests
{
    [Fact]
    public void Detect_Png_ReturnsImagePng()
    {
        var result = MimeDetector.Detect(TestBytes.Png);
        Assert.Equal("image/png", result.MimeType);
        Assert.Equal("png", result.Extension);
    }

    [Fact]
    public void Detect_Pdf_ReturnsApplicationPdf()
    {
        var result = MimeDetector.Detect(TestBytes.Pdf);
        Assert.Equal("application/pdf", result.MimeType);
        Assert.Equal("pdf", result.Extension);
    }

    [Fact]
    public void Detect_Jpeg_ReturnsImageJpeg()
    {
        var result = MimeDetector.Detect(TestBytes.Jpeg);
        Assert.Equal("image/jpeg", result.MimeType);
    }

    [Fact]
    public void Detect_EmptyBytes_ReturnsDefault()
    {
        var result = MimeDetector.Detect(System.ReadOnlySpan<byte>.Empty);
        Assert.Null(result.MimeType);
        Assert.Null(result.Extension);
    }

    [Fact]
    public void Detect_Stream_RestoresPosition_WhenSeekable()
    {
        using var ms = new MemoryStream(TestBytes.Png);
        ms.Position = 0;
        var result = MimeDetector.Detect(ms);
        Assert.Equal("image/png", result.MimeType);
        Assert.Equal(0, ms.Position); // Mime-Detective was asked to reset.
    }
}
