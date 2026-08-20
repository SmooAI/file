using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;

namespace SmooAI.File.Tests;

/// <summary>
/// The .NET loader for the shared error taxonomy.
///
/// Every port has one of these and they all read the SAME file
/// (spec/error-taxonomy.json). Copying the Kind values into this class instead
/// is the drift the fixture exists to stop.
/// </summary>
public class ErrorTaxonomyTests
{
    private static readonly Taxonomy Spec = LoadTaxonomy();

    public static TheoryData<string> CaseNames
    {
        get
        {
            var data = new TheoryData<string>();
            foreach (var c in Spec.Cases) data.Add(c.Name);
            return data;
        }
    }

    private static TaxonomyCase Case(string name) => Spec.Cases.Single(c => c.Name == name);

    private static Taxonomy LoadTaxonomy()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = System.IO.Path.Combine(dir.FullName, "spec", "error-taxonomy.json");
            if (System.IO.File.Exists(candidate))
            {
                var parsed = JsonSerializer.Deserialize<Taxonomy>(System.IO.File.ReadAllText(candidate))
                    ?? throw new InvalidOperationException($"could not parse {candidate}");
                if (parsed.Cases.Count == 0)
                    throw new InvalidOperationException("taxonomy has no cases — a fixture nobody exercises is worse than none");
                return parsed;
            }
            dir = dir.Parent;
        }

        throw new FileNotFoundException($"spec/error-taxonomy.json not found above {AppContext.BaseDirectory}");
    }

    private static FileValidationException Build(TaxonomyCase c)
    {
        if (c.Kind == Spec.Kinds["size"].Value)
            return new FileSizeException(c.ActualSize, c.MaxSize ?? throw new InvalidOperationException("size case needs maxSize"));
        if (c.Kind == Spec.Kinds["mime"].Value)
            return new FileMimeException(c.ActualMimeType, c.AllowedMimeTypes ?? throw new InvalidOperationException("mime case needs allowedMimeTypes"));
        if (c.Kind == Spec.Kinds["contentMismatch"].Value)
            return new FileContentMismatchException(c.ClaimedMimeType, c.DetectedMimeType);
        throw new InvalidOperationException($"fixture has an unknown kind: {c.Kind}");
    }

    [Fact]
    public void ExposesExactlyTheDeclaredKinds()
    {
        var exposed = new[] { FileValidationKind.Size, FileValidationKind.Mime, FileValidationKind.ContentMismatch }.OrderBy(k => k);
        var declared = Spec.Kinds.Values.Select(k => k.Value).OrderBy(k => k);
        Assert.Equal(exposed, declared);
    }

    [Fact]
    public void CasesCoverEveryDeclaredKind()
    {
        // Positive control: a fixture that silently lost a kind would leave the
        // per-case tests asserting nothing about it, while still passing.
        var covered = Spec.Cases.Select(c => c.Kind).Distinct().OrderBy(k => k);
        var declared = Spec.Kinds.Values.Select(k => k.Value).OrderBy(k => k);
        Assert.Equal(declared, covered);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void CarriesThePortableKind(string name)
    {
        var c = Case(name);
        Assert.Equal(c.Kind, Build(c).Kind);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void IsCatchableAsFileValidationException(string name)
    {
        Assert.IsAssignableFrom<FileValidationException>(Build(Case(name)));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void CarriesTheStructuredFields(string name)
    {
        var c = Case(name);
        switch (Build(c))
        {
            case FileSizeException size:
                Assert.Equal(c.ActualSize, size.ActualSize);
                Assert.Equal(c.MaxSize, size.MaxSize);
                break;
            case FileMimeException mime:
                Assert.Equal(c.ActualMimeType, mime.ActualMimeType);
                Assert.Equal(c.AllowedMimeTypes, mime.AllowedMimeTypes);
                break;
            case FileContentMismatchException mismatch:
                Assert.Equal(c.ClaimedMimeType, mismatch.ClaimedMimeType);
                Assert.Equal(c.DetectedMimeType, mismatch.DetectedMimeType);
                break;
        }
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void HasANonEmptyMessage(string name)
    {
        // The wording is deliberately NOT pinned across ports — Go's is
        // idiomatically Go. That every port says something is still worth checking.
        Assert.NotEmpty(Build(Case(name)).Message);
    }

    private sealed class Taxonomy
    {
        [JsonPropertyName("kinds")] public Dictionary<string, KindSpec> Kinds { get; set; } = [];
        [JsonPropertyName("cases")] public List<TaxonomyCase> Cases { get; set; } = [];
    }

    private sealed class KindSpec
    {
        [JsonPropertyName("value")] public string Value { get; set; } = "";
    }

    private sealed class TaxonomyCase
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        [JsonPropertyName("actualSize")] public long? ActualSize { get; set; }
        [JsonPropertyName("maxSize")] public long? MaxSize { get; set; }
        [JsonPropertyName("actualMimeType")] public string? ActualMimeType { get; set; }
        [JsonPropertyName("allowedMimeTypes")] public List<string>? AllowedMimeTypes { get; set; }
        [JsonPropertyName("claimedMimeType")] public string? ClaimedMimeType { get; set; }
        [JsonPropertyName("detectedMimeType")] public string? DetectedMimeType { get; set; }
    }
}
