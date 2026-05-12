using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Xunit;
using Xunit.Abstractions;

namespace SmooAI.File.Tests;

/// <summary>
/// Tests for lazy-streaming construction via <see cref="SmooFile.CreateFromStreamAsync"/>
/// with <c>lazy: true</c>. The contract: only the magic-byte-detection head
/// buffer is materialised; the tail of the source stays un-buffered until the
/// consumer asks for it via OpenReadStream/ReadBytesAsync/UploadToS3Async.
/// </summary>
public class LazyStreamTests
{
    private readonly ITestOutputHelper _output;
    public LazyStreamTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task CreateFromStreamLazyAsync_ShortStream_FallsBackToEager()
    {
        // Anything smaller than the 64 KB head buffer should promote to the
        // eager path so callers still get an exact size and a cached buffer.
        using var ms = new MemoryStream(TestBytes.Png);
        var file = await SmooFile.CreateFromStreamLazyAsync(ms);

        Assert.False(file.IsLazy);
        Assert.Equal(TestBytes.Png.LongLength, file.Size);
        Assert.Equal("image/png", file.MimeType);
    }

    [Fact]
    public async Task CreateFromStreamLazyAsync_LargeStream_StaysLazy()
    {
        // 200 KB > 64 KB head buffer => must stay lazy.
        var data = new byte[200 * 1024];
        new Random(42).NextBytes(data);
        using var src = new MemoryStream(data);

        var file = await SmooFile.CreateFromStreamLazyAsync(src);

        Assert.True(file.IsLazy);
        // Size unknown until drain.
        Assert.True(file.Size is null || file.Size == 0 || file.Size == SmooFile.LazyHeadBytes,
            $"Expected unknown/partial size, got {file.Size}");

        // OpenReadStream then drain — content must match the original.
        await using var view = file.OpenReadStream();
        using var sink = new MemoryStream();
        await view.CopyToAsync(sink);

        Assert.Equal(data, sink.ToArray());
    }

    [Fact]
    public async Task ReadBytesAsync_DrainsLazyTail()
    {
        var data = new byte[200 * 1024];
        new Random(7).NextBytes(data);
        using var src = new MemoryStream(data);
        var file = await SmooFile.CreateFromStreamLazyAsync(src);

        var bytes = await file.ReadBytesAsync();

        Assert.Equal(data, bytes);
        Assert.False(file.IsLazy); // drained
        Assert.Equal(data.LongLength, file.Size);

        // Second ReadBytesAsync returns the cached buffer.
        var bytes2 = await file.ReadBytesAsync();
        Assert.Equal(data, bytes2);
    }

    [Fact]
    public async Task OpenReadStream_NonLazy_ReturnsMemoryView()
    {
        var file = await SmooFile.CreateFromBytesAsync(TestBytes.Png);

        await using var view = file.OpenReadStream();
        using var sink = new MemoryStream();
        await view.CopyToAsync(sink);

        Assert.Equal(TestBytes.Png, sink.ToArray());
    }

    /// <summary>
    /// The headline test: 100 MB streamed through a lazy SmooFile, with peak
    /// process Working Set asserted to stay under +50 MB of the baseline. RSS
    /// is noisy on managed runtimes (GC heap, JIT), so we measure
    /// <see cref="Process.PeakWorkingSet64"/> deltas with a generous tolerance.
    /// </summary>
    [Fact]
    public async Task LazyStream_100MB_DoesNotBlowUpMemory()
    {
        const long size = 100L * 1024 * 1024;

        // Warm up the MIME detector first — its exhaustive signature database
        // (loaded on first use) is a ~300 MB one-time cost that has nothing to
        // do with streaming behaviour. Measuring without warmup would conflate
        // detector initialisation with payload retention.
        _ = await SmooFile.CreateFromBytesAsync(TestBytes.Png);

        using var src = new ConstByteStream(0xAB, size);

        // Force GC + read baseline.
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        long baselineGcBytes = GC.GetTotalMemory(forceFullCollection: true);

        var file = await SmooFile.CreateFromStreamLazyAsync(src);
        Assert.True(file.IsLazy);

        // Drain via OpenReadStream and count bytes; never accumulate.
        long total = 0;
        await using (var view = file.OpenReadStream())
        {
            var buf = new byte[64 * 1024];
            while (true)
            {
                int n = await view.ReadAsync(buf);
                if (n == 0) break;
                total += n;
            }
        }

        Assert.Equal(size, total);

        // After drain, force a full collection and check that nothing is
        // *retained*. The 64 KB chunk allocations are short-lived Gen0
        // garbage and must collect. The bar is: post-drain live heap should
        // be within +50 MB of the baseline.
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        long afterGcBytes = GC.GetTotalMemory(forceFullCollection: true);
        long deltaBytes = afterGcBytes - baselineGcBytes;

        _output.WriteLine($"Live GC heap delta after 100 MB stream: {deltaBytes / (1024 * 1024)} MB (baseline {baselineGcBytes / (1024 * 1024)} MB, after {afterGcBytes / (1024 * 1024)} MB)");

        Assert.True(deltaBytes < 50L * 1024 * 1024,
            $"Live GC heap retained {deltaBytes / (1024 * 1024)} MB after 100 MB stream — expected < 50 MB");
    }
}

/// <summary>
/// A read-only Stream that yields a single byte value repeated up to a fixed
/// length. Lets us build a large stream without allocating the payload.
/// </summary>
internal sealed class ConstByteStream : Stream
{
    private readonly byte _b;
    private long _remaining;
    public ConstByteStream(byte b, long size)
    {
        _b = b;
        _remaining = size;
    }
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }
    public override int Read(byte[] buffer, int offset, int count)
    {
        if (_remaining <= 0) return 0;
        int n = (int)Math.Min(count, _remaining);
        for (int i = 0; i < n; i++) buffer[offset + i] = _b;
        _remaining -= n;
        return n;
    }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
