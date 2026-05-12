using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Xunit;

namespace SmooAI.File.Tests;

public class ToFormDataTests
{
    [Fact]
    public async Task ToFormData_BuildsMultipartContent_WithDefaultAttrName()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png, o => o.Name = "pic.png");
        using var form = file.ToFormData();

        // Round-trip through HttpClient's multipart serializer to confirm the
        // form is well-formed.
        var bytes = await form.ReadAsByteArrayAsync();
        Assert.NotEmpty(bytes);

        var contentType = form.Headers.ContentType!.ToString();
        Assert.StartsWith("multipart/form-data; boundary=", contentType);

        var parts = form.ToList();
        Assert.Single(parts);
        var part = parts[0];
        var disposition = part.Headers.ContentDisposition!;
        Assert.Equal("file", disposition.Name?.Trim('"'));
        Assert.Equal("pic.png", disposition.FileName?.Trim('"'));
        Assert.Equal("image/png", part.Headers.ContentType?.MediaType);
        Assert.Equal(TestBytes.Png, await part.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task ToFormData_CustomAttrName()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png, o => o.Name = "x.png");
        using var form = file.ToFormData("document");
        var part = form.Single();
        Assert.Equal("document", part.Headers.ContentDisposition!.Name?.Trim('"'));
    }

    [Fact]
    public async Task ToFormData_NoName_StillProducesValidForm()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);
        using var form = file.ToFormData();
        var bytes = await form.ReadAsByteArrayAsync();
        Assert.NotEmpty(bytes);
    }
}
