using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;

namespace SmooAI.File.Tests;

/// <summary>
/// The .NET loader for the shared lazy-streaming contract.
///
/// Every port has one of these and they all read the SAME file
/// (spec/lazy-stream-contract.json). Copying the numbers into this class
/// instead is the drift this fixture exists to stop.
/// </summary>
public class LazyContractTests
{
    private static readonly LazyContract Contract = LoadContract();

    public static TheoryData<string> CaseNames
    {
        get
        {
            var data = new TheoryData<string>();
            foreach (var c in Contract.Cases) data.Add(c.Name);
            return data;
        }
    }

    private static ContractCase Case(string name) => Contract.Cases.Single(c => c.Name == name);

    private static LazyContract LoadContract()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = System.IO.Path.Combine(dir.FullName, "spec", "lazy-stream-contract.json");
            if (System.IO.File.Exists(candidate))
            {
                var parsed = JsonSerializer.Deserialize<LazyContract>(System.IO.File.ReadAllText(candidate))
                    ?? throw new InvalidOperationException($"could not parse {candidate}");
                if (parsed.Cases.Count == 0)
                    throw new InvalidOperationException("contract has no cases — a fixture nobody exercises is worse than none");
                return parsed;
            }
            dir = dir.Parent;
        }

        throw new FileNotFoundException($"spec/lazy-stream-contract.json not found above {AppContext.BaseDirectory}");
    }

    private static byte[] SourceBytes(int byteLength)
    {
        var pattern = Encoding.ASCII.GetBytes(Contract.Fill.Pattern);
        var payload = new byte[byteLength];
        for (var i = 0; i < byteLength; i++) payload[i] = pattern[i % pattern.Length];
        return payload;
    }

    /// <summary>Delivers the payload in small chunks, like a socket would.</summary>
    private static Stream ChunkedStream(byte[] payload) => new ChunkedReadStream(payload, 4096);

    private static string Sha256Hex(byte[] payload) => Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();

    [Fact]
    public void HeadBytesMatchesContract()
    {
        Assert.Equal(SmooFile.LazyHeadBytes, Contract.HeadBytes);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void FixtureContentIsReproducible(string name)
    {
        // Positive control: without this, a broken SourceBytes would make every
        // assertion below compare two identically-wrong values and pass.
        var c = Case(name);
        var payload = SourceBytes(c.SourceBytes);
        Assert.Equal(c.SourceBytes, payload.Length);
        Assert.Equal(c.Sha256, Sha256Hex(payload));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task LazyConstructorLaziness(string name)
    {
        var c = Case(name);
        var file = await SmooFile.CreateFromStreamLazyAsync(ChunkedStream(SourceBytes(c.SourceBytes)));

        Assert.Equal(c.LazyAfterConstruct, file.IsLazy);
        Assert.Equal(c.SizeKnownAfterConstruct, file.Size is not null);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task FullReadYieldsEveryByte(string name)
    {
        var c = Case(name);
        var file = await SmooFile.CreateFromStreamLazyAsync(ChunkedStream(SourceBytes(c.SourceBytes)));
        var data = await file.ReadBytesAsync();

        Assert.Equal(c.SourceBytes, data.Length);
        Assert.Equal(c.Sha256, Sha256Hex(data));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task IterationYieldsEveryByte(string name)
    {
        // OpenReadStream is .NET's bounded-memory iterator — the counterpart to
        // iterBytes / iter_bytes / IterBytes in the other four ports.
        var c = Case(name);
        var file = await SmooFile.CreateFromStreamLazyAsync(ChunkedStream(SourceBytes(c.SourceBytes)));

        await using var reader = file.OpenReadStream();
        using var collected = new MemoryStream();
        await reader.CopyToAsync(collected);
        var data = collected.ToArray();

        Assert.Equal(c.SourceBytes, data.Length);
        Assert.Equal(c.Sha256, Sha256Hex(data));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task EagerConstructorBuffersEverything(string name)
    {
        var c = Case(name);
        var file = await SmooFile.CreateFromStreamAsync(ChunkedStream(SourceBytes(c.SourceBytes)), lazy: false);

        Assert.Equal(Contract.EagerConstructor.LazyAfterConstruct, file.IsLazy);
        Assert.Equal(Contract.EagerConstructor.SizeKnownAfterConstruct, file.Size is not null);
        Assert.Equal(c.SourceBytes, file.Size);
    }

    [Fact]
    public async Task ReadCachesAndIterationDoesNot()
    {
        Assert.True(Contract.FullRead.ReadCaches);
        Assert.False(Contract.FullRead.IterCaches);
        Assert.False(Contract.FullRead.PayloadReplayedAfterIteration);

        var c = Contract.Cases[^1];

        var cached = await SmooFile.CreateFromStreamLazyAsync(ChunkedStream(SourceBytes(c.SourceBytes)));
        Assert.Equal(c.Sha256, Sha256Hex(await cached.ReadBytesAsync()));
        Assert.Equal(c.Sha256, Sha256Hex(await cached.ReadBytesAsync()));

        var consumed = await SmooFile.CreateFromStreamLazyAsync(ChunkedStream(SourceBytes(c.SourceBytes)));
        await using (var reader = consumed.OpenReadStream())
        {
            await reader.CopyToAsync(Stream.Null);
        }

        // .NET reports the drained tail as an empty read; Go raises instead. The
        // fixture names that divergence — what all five share is non-replay.
        var leftovers = await consumed.ReadBytesAsync();
        Assert.NotEqual(c.SourceBytes, leftovers.Length);
        Assert.Empty(leftovers);
    }

    /// <summary>A stream that never returns more than <c>chunkSize</c> bytes per read.</summary>
    private sealed class ChunkedReadStream(byte[] payload, int chunkSize) : Stream
    {
        private int _offset;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => payload.Length;
        public override long Position { get => _offset; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count)
        {
            var remaining = payload.Length - _offset;
            if (remaining <= 0) return 0;
            var n = Math.Min(Math.Min(count, chunkSize), remaining);
            Buffer.BlockCopy(payload, _offset, buffer, offset, n);
            _offset += n;
            return n;
        }

        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class LazyContract
    {
        [JsonPropertyName("headBytes")] public int HeadBytes { get; set; }
        [JsonPropertyName("fill")] public FillSpec Fill { get; set; } = new();
        [JsonPropertyName("cases")] public List<ContractCase> Cases { get; set; } = [];
        [JsonPropertyName("eagerConstructor")] public ConstructorSpec EagerConstructor { get; set; } = new();
        [JsonPropertyName("fullRead")] public FullReadSpec FullRead { get; set; } = new();
    }

    private sealed class FillSpec
    {
        [JsonPropertyName("pattern")] public string Pattern { get; set; } = "";
    }

    private sealed class ConstructorSpec
    {
        [JsonPropertyName("lazyAfterConstruct")] public bool LazyAfterConstruct { get; set; }
        [JsonPropertyName("sizeKnownAfterConstruct")] public bool SizeKnownAfterConstruct { get; set; }
    }

    private sealed class FullReadSpec
    {
        [JsonPropertyName("readCaches")] public bool ReadCaches { get; set; }
        [JsonPropertyName("iterCaches")] public bool IterCaches { get; set; }
        [JsonPropertyName("payloadReplayedAfterIteration")] public bool PayloadReplayedAfterIteration { get; set; }
    }

    private sealed class ContractCase
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("sourceBytes")] public int SourceBytes { get; set; }
        [JsonPropertyName("lazyAfterConstruct")] public bool LazyAfterConstruct { get; set; }
        [JsonPropertyName("sizeKnownAfterConstruct")] public bool SizeKnownAfterConstruct { get; set; }
        [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    }
}
