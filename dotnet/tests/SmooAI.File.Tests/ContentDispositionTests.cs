using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Xunit;

namespace SmooAI.File.Tests;

public class ContentDispositionTests
{
    [Fact]
    public void Parse_PlainQuotedFilename_Extracts()
    {
        var cd = ContentDisposition.Parse("attachment; filename=\"example.pdf\"");
        Assert.NotNull(cd);
        Assert.Equal("attachment", cd!.DispositionType);
        Assert.Equal("example.pdf", cd.Filename);
    }

    [Fact]
    public void Parse_UnquotedFilename_Extracts()
    {
        var cd = ContentDisposition.Parse("attachment; filename=example.pdf");
        Assert.Equal("example.pdf", cd!.Filename);
    }

    [Fact]
    public void Parse_Rfc5987EncodedFilename_Decodes()
    {
        // %E4%BD%A0 → "你" (UTF-8)
        var cd = ContentDisposition.Parse("attachment; filename*=UTF-8''%E4%BD%A0.pdf");
        Assert.NotNull(cd);
        Assert.Equal("你.pdf", cd!.Filename);
    }

    [Fact]
    public void Parse_FilenameStarTakesPrecedence_OverPlainFilename()
    {
        var cd = ContentDisposition.Parse("attachment; filename=\"fallback.txt\"; filename*=UTF-8''preferred.txt");
        Assert.Equal("preferred.txt", cd!.Filename);
    }

    [Fact]
    public void Parse_InlineDisposition_Extracts()
    {
        var cd = ContentDisposition.Parse("inline; filename=\"photo.jpg\"");
        Assert.Equal("inline", cd!.DispositionType);
        Assert.Equal("photo.jpg", cd.Filename);
    }

    [Fact]
    public void Parse_EmptyOrNull_ReturnsNull()
    {
        Assert.Null(ContentDisposition.Parse(null));
        Assert.Null(ContentDisposition.Parse(""));
        Assert.Null(ContentDisposition.Parse("   "));
    }

    [Fact]
    public void ExtractFilename_FromHeaderValue_HandlesNullDisposition()
    {
        Assert.Null(ContentDisposition.ExtractFilename((ContentDispositionHeaderValue?)null));
    }

    [Fact]
    public void ExtractFilename_FromHeaderValue_PrefersFilenameStar()
    {
        var hdr = new ContentDispositionHeaderValue("attachment")
        {
            FileName = "\"plain.txt\"",
            FileNameStar = "preferred.txt",
        };
        Assert.Equal("preferred.txt", ContentDisposition.ExtractFilename(hdr));
    }

    [Fact]
    public async Task CreateFromUrlAsync_FallsBackToUrlBasename_WhenHeaderMissing()
    {
        var handler = new StubHandler(setDisposition: false);
        using var client = new HttpClient(handler);
        var file = await SmooFile.CreateFromUrlAsync("https://example.com/path/report.pdf", client);
        Assert.Equal("report.pdf", file.Name);
    }

    [Fact]
    public async Task CreateFromUrlAsync_UsesContentDispositionFilename_WhenPresent()
    {
        var handler = new StubHandler(setDisposition: true, disposition: "attachment; filename=\"server-named.bin\"");
        using var client = new HttpClient(handler);
        var file = await SmooFile.CreateFromUrlAsync("https://example.com/path/ignored.pdf", client);
        Assert.Equal("server-named.bin", file.Name);
    }

    [Fact]
    public async Task CreateFromUrlAsync_UsesRfc5987EncodedFilename_WhenPresent()
    {
        var handler = new StubHandler(setDisposition: true, disposition: "attachment; filename*=UTF-8''%E4%BD%A0.pdf");
        using var client = new HttpClient(handler);
        var file = await SmooFile.CreateFromUrlAsync("https://example.com/path/ignored.pdf", client);
        Assert.Equal("你.pdf", file.Name);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly bool _setDisposition;
        private readonly string? _disposition;

        public StubHandler(bool setDisposition, string? disposition = null)
        {
            _setDisposition = setDisposition;
            _disposition = disposition;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, System.Threading.CancellationToken cancellationToken)
        {
            var content = new ByteArrayContent(TestBytes.Png);
            content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            if (_setDisposition && _disposition is not null)
                content.Headers.TryAddWithoutValidation("Content-Disposition", _disposition);
            var resp = new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
            return Task.FromResult(resp);
        }
    }
}
