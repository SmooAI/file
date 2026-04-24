using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Xunit;

namespace SmooAI.File.Tests;

public class SmooFileTests
{
    [Fact]
    public async Task CreateFromBytesAsync_Png_DetectsMimeAndSize()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png, o => o.Name = "tiny.png");

        Assert.Equal("image/png", file.MimeType);
        Assert.Equal("png", file.Extension);
        Assert.Equal(TestBytes.Png.LongLength, file.Size);
        Assert.Equal("tiny.png", file.Name);
        Assert.Equal(FileSource.Bytes, file.Source);
    }

    [Fact]
    public async Task CreateFromBytesAsync_IgnoresExtensionLie()
    {
        // Caller claims this is a PDF but the bytes are PNG — magic-byte detection wins.
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png, o =>
        {
            o.Name = "document.pdf";
            o.MimeType = "application/pdf";
        });

        Assert.Equal("image/png", file.MimeType);
        Assert.Equal("image/png", file.Detected.MimeType);
    }

    [Fact]
    public async Task CreateFromStreamAsync_ReadsPngFromStream()
    {
        using var ms = new MemoryStream(TestBytes.Png);
        var file = await SmooFile.CreateFromStreamAsync(ms);
        Assert.Equal("image/png", file.MimeType);
        Assert.Equal(TestBytes.Png.LongLength, file.Size);
    }

    [Fact]
    public async Task CreateFromFileAsync_ReadsFromDisk()
    {
        var path = Path.GetTempFileName();
        try
        {
            await System.IO.File.WriteAllBytesAsync(path, TestBytes.Png);
            var file = await SmooFile.CreateFromFileAsync(path);
            Assert.Equal("image/png", file.MimeType);
            Assert.Equal(path, file.Path);
            Assert.NotNull(file.LastModified);
        }
        finally
        {
            System.IO.File.Delete(path);
        }
    }

    [Fact]
    public async Task ToBase64Async_ProducesRoundTrippableString()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var b64 = await file.ToBase64Async();
        var round = Convert.FromBase64String(b64);
        Assert.Equal(TestBytes.Png, round);
    }

    [Fact]
    public async Task ReadStringAsync_DecodesUtf8Payload()
    {
        var payload = "hello world"u8.ToArray();
        var file = await SmooFile.CreateFromBytesAsync(payload);
        Assert.Equal("hello world", await file.ReadStringAsync());
    }

    [Fact]
    public async Task GetChecksumAsync_ReturnsStableSha256()
    {
        var file1 = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var file2 = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        Assert.Equal(await file1.GetChecksumAsync(), await file2.GetChecksumAsync());
        Assert.Matches("^[0-9a-f]{64}$", await file1.GetChecksumAsync());
    }

    [Fact]
    public async Task SaveToFileAsync_WritesContentToDisk()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var path = Path.Combine(Path.GetTempPath(), $"smoofile-{Guid.NewGuid():N}.png");
        try
        {
            await file.SaveToFileAsync(path);
            Assert.Equal(TestBytes.Png, await System.IO.File.ReadAllBytesAsync(path));
        }
        finally
        {
            System.IO.File.Delete(path);
        }
    }

    [Fact]
    public async Task Validate_MaxSize_ThrowsFileSizeException()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var ex = Assert.Throws<FileSizeException>(() => file.Validate(maxSize: 10));
        Assert.Equal(10, ex.MaxSize);
        Assert.Equal(TestBytes.Png.LongLength, ex.ActualSize);
    }

    [Fact]
    public async Task Validate_DisallowedMime_ThrowsFileMimeException()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var ex = Assert.Throws<FileMimeException>(() => file.Validate(allowedMimes: new[] { "image/jpeg" }));
        Assert.Equal("image/png", ex.ActualMimeType);
    }

    [Fact]
    public async Task Validate_AllowedMime_Passes()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        file.Validate(allowedMimes: new[] { "image/png", "image/jpeg" });
    }

    [Fact]
    public async Task Validate_ExpectedMime_ThrowsContentMismatch_WhenMagicBytesDisagree()
    {
        // Bytes are PNG but we claim image/jpeg — classic MIME spoof.
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        var ex = Assert.Throws<FileContentMismatchException>(() => file.Validate(expectedMimeType: "image/jpeg"));
        Assert.Equal("image/jpeg", ex.ClaimedMimeType);
        Assert.Equal("image/png", ex.DetectedMimeType);
    }

    [Fact]
    public async Task Validate_ExpectedMime_Passes_WhenDetectionAgrees()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        file.Validate(expectedMimeType: "image/png");
    }

    [Fact]
    public async Task ValidateAsync_AllowsOneCallFor_Size_Mime_And_Claim()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png, o => o.Name = "tiny.png");
        await file.ValidateAsync(new ValidateOptions
        {
            MaxSize = 10_000_000,
            AllowedMimes = new[] { "image/png" },
            ExpectedMimeType = "image/png",
        });
    }

    [Fact]
    public async Task AllValidationErrors_Derive_From_FileValidationException()
    {
        // One catch block should be able to handle all three via the base type — important
        // because the common call site just maps these to HTTP 400.
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        try
        {
            file.Validate(maxSize: 1);
        }
        catch (FileValidationException ex)
        {
            Assert.IsType<FileSizeException>(ex);
            return;
        }
        Assert.Fail("Expected FileValidationException");
    }
}
