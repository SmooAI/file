using System.IO;
using System.Threading.Tasks;
using Xunit;

namespace SmooAI.File.Tests;

public class CreateFromFormFileTests
{
    [Fact]
    public async Task PreservesFilenameAndContentTypeFromHints()
    {
        using var ms = new MemoryStream(TestBytes.Png);
        var file = await SmooFile.CreateFromFormFileAsync(ms, "pic.png", "image/png");
        Assert.Equal("pic.png", file.Name);
        // Magic-byte detection wins (still image/png because bytes are PNG).
        Assert.Equal("image/png", file.MimeType);
        Assert.Equal(TestBytes.Png, await file.ReadBytesAsync());
    }

    [Fact]
    public async Task MissingNameAndContentType_StillBuildsFile()
    {
        using var ms = new MemoryStream(TestBytes.Png);
        var file = await SmooFile.CreateFromFormFileAsync(ms);
        // Magic-byte detection still kicks in.
        Assert.Equal("image/png", file.MimeType);
    }

    [Fact]
    public async Task ConfigureOptionsOverride_FromHints()
    {
        using var ms = new MemoryStream(TestBytes.Png);
        var file = await SmooFile.CreateFromFormFileAsync(ms, "original.png", "image/png", o => o.Name = "renamed.png");
        Assert.Equal("renamed.png", file.Name);
    }
}
