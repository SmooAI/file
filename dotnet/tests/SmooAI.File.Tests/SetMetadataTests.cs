using System.Text;
using Xunit;

namespace SmooAI.File.Tests;

public class SetMetadataTests
{
    private static Task<SmooFile> TextFileAsync() =>
        SmooFile.CreateFromBytesAsync(Encoding.UTF8.GetBytes("hello, world"), o => o.Name = "original.txt");

    [Fact]
    public async Task OverwritesTheFieldsThatAreSet()
    {
        var file = await TextFileAsync();

        file.SetMetadata(new FileMetadata { Name = "renamed.txt", Hash = "abc123" });

        Assert.Equal("renamed.txt", file.Name);
        Assert.Equal("abc123", file.Hash);
    }

    [Fact]
    public async Task LeavesUnsetFieldsAlone()
    {
        var file = await TextFileAsync();
        var originalMime = file.MimeType;
        var originalSize = file.Size;

        file.SetMetadata(new FileMetadata { Name = "renamed.txt" });

        Assert.Equal(originalMime, file.MimeType);
        Assert.Equal(originalSize, file.Size);
    }

    [Fact]
    public async Task RejectsNull()
    {
        var file = await TextFileAsync();
        Assert.Throws<ArgumentNullException>(() => file.SetMetadata(null!));
    }
}
