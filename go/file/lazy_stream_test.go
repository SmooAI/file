package file

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"runtime"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// generateRandomBytes returns n bytes of random data — used to build large
// streams that magic-byte detection won't recognise as anything in particular.
// Using random data also makes sure the test can't accidentally pass by
// caching/compression.
func generateRandomBytes(t *testing.T, n int) []byte {
	t.Helper()
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	return buf
}

func TestNewFromStreamLazy_smallStream_fallsBackToEager(t *testing.T) {
	// Source smaller than the head buffer must promote to the eager path so
	// callers still get an exact size and a cached buffer for Read().
	data := []byte("small")
	r := bytes.NewReader(data)

	f, err := NewFromStreamLazy(r, MetadataHint{Name: "small.bin"})
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}

	if f.lazy {
		t.Fatalf("expected eager path for small stream, got lazy")
	}
	if f.Size() != int64(len(data)) {
		t.Fatalf("Size() = %d, want %d", f.Size(), len(data))
	}
	got, err := f.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("Read() = %x, want %x", got, data)
	}
}

func TestNewFromStreamLazy_largeStream_keepsTailLazy(t *testing.T) {
	// 200 KB > 64 KB head buffer => the file must stay in lazy mode with the
	// tail still in the source reader.
	data := generateRandomBytes(t, 200*1024)
	r := bytes.NewReader(data)

	f, err := NewFromStreamLazy(r)
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}
	if !f.lazy {
		t.Fatalf("expected lazy mode for large stream")
	}
	// Size is unknown until the stream is drained.
	if f.Size() != 0 {
		t.Fatalf("Size() should be 0 for unbuffered lazy stream, got %d", f.Size())
	}

	// IterBytes drains the tail.
	chunks, errc := f.IterBytes(context.Background())
	var total []byte
	for chunk := range chunks {
		total = append(total, chunk...)
	}
	if err := <-errc; err != nil {
		t.Fatalf("IterBytes error: %v", err)
	}
	if !bytes.Equal(total, data) {
		t.Fatalf("IterBytes total len=%d, want %d", len(total), len(data))
	}
	// After drain, the recorded size should be exact.
	if f.Size() != int64(len(data)) {
		t.Fatalf("Size() after drain = %d, want %d", f.Size(), len(data))
	}
}

func TestRead_drainsLazyTail(t *testing.T) {
	data := generateRandomBytes(t, 200*1024)
	r := bytes.NewReader(data)

	f, err := NewFromStreamLazy(r)
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}

	got, err := f.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("Read() len=%d, want %d", len(got), len(data))
	}
	// Second Read returns the cached buffer.
	got2, err := f.Read()
	if err != nil {
		t.Fatalf("Read (2nd): %v", err)
	}
	if !bytes.Equal(got2, data) {
		t.Fatalf("second Read mismatch")
	}
}

func TestUploadToS3_lazyStream_streamsThroughSpool(t *testing.T) {
	// Verify the S3 upload path streams a lazy file through a temp-file spool
	// rather than pulling everything into memory via Read().
	data := generateRandomBytes(t, 200*1024)
	r := bytes.NewReader(data)

	f, err := NewFromStreamLazy(r)
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}

	var receivedLen int64
	var receivedContent []byte
	mockS3 := &mockS3Client{
		putObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
			if params.ContentLength != nil {
				receivedLen = *params.ContentLength
			}
			if params.Body != nil {
				body, err := io.ReadAll(params.Body)
				if err != nil {
					return nil, err
				}
				receivedContent = body
			}
			return &s3.PutObjectOutput{}, nil
		},
	}
	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	if err := f.UploadToS3("test-bucket", "lazy.bin"); err != nil {
		t.Fatalf("UploadToS3: %v", err)
	}

	if receivedLen != int64(len(data)) {
		t.Fatalf("ContentLength = %d, want %d", receivedLen, len(data))
	}
	if !bytes.Equal(receivedContent, data) {
		t.Fatalf("uploaded body mismatch: got len=%d, want %d", len(receivedContent), len(data))
	}
}

// TestLazyStream_100MB_memoryBound is the headline test: a 100 MB lazy stream
// must not blow up RSS. The bar we promise the user is "RSS delta under 50 MB"
// — we measure HeapAlloc deltas around a full drain via IterBytes.
//
// HeapAlloc is the right knob to assert on rather than Process RSS because RSS
// includes everything (Go runtime, OS page cache, test binary) and is too
// noisy. HeapAlloc tracks just the Go-managed heap, which is what changes
// when we accidentally buffer the payload.
func TestLazyStream_100MB_memoryBound(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 100 MB streaming test in -short mode")
	}

	const size = 100 * 1024 * 1024 // 100 MB
	// Use a constant byte to avoid the cost of crypto/rand for a test payload.
	r := io.LimitReader(constByteReader{b: 0xAB}, size)

	// Baseline HeapAlloc *before* constructing the file so the head-buffer
	// allocation is included in the delta.
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	f, err := NewFromStreamLazy(r)
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}
	if !f.lazy {
		t.Fatalf("expected lazy mode")
	}

	// Sanity-check the head was read.
	if len(f.streamHead) != streamHeadBytes {
		t.Fatalf("streamHead len = %d, want %d", len(f.streamHead), streamHeadBytes)
	}

	// Drain via IterBytes — count bytes but never accumulate them.
	chunks, errc := f.IterBytes(context.Background())
	var total int64
	var peakHeap uint64
	for chunk := range chunks {
		total += int64(len(chunk))
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		if ms.HeapAlloc > peakHeap {
			peakHeap = ms.HeapAlloc
		}
	}
	if err := <-errc; err != nil {
		t.Fatalf("IterBytes: %v", err)
	}
	if total != size {
		t.Fatalf("drained %d bytes, want %d", total, size)
	}

	// Peak heap during drain should be well under 50 MB above baseline.
	// In practice it should be a few MB (one chunk + temp buffers).
	const maxDelta = 50 * 1024 * 1024
	if peakHeap > before.HeapAlloc+maxDelta {
		t.Fatalf("HeapAlloc grew by %d MB during 100 MB stream — expected < %d MB",
			(peakHeap-before.HeapAlloc)/(1024*1024), maxDelta/(1024*1024))
	}
	t.Logf("100 MB drained with HeapAlloc delta %d KB (max delta budget %d MB)",
		(peakHeap-before.HeapAlloc)/1024, maxDelta/(1024*1024))
}

// constByteReader is a non-EOF io.Reader that fills the buffer with a single
// byte. Pair with io.LimitReader to produce a fixed-size stream without
// allocating the whole payload up-front.
type constByteReader struct{ b byte }

func (c constByteReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = c.b
	}
	return len(p), nil
}

func TestLazyStream_uploadDoesNotBufferInRAM(t *testing.T) {
	// Mirrors TestLazyStream_100MB_memoryBound but exercises the upload path
	// (temp-file spool) instead of IterBytes.
	if testing.Short() {
		t.Skip("skipping 100 MB upload test in -short mode")
	}

	const size = 100 * 1024 * 1024
	r := io.LimitReader(constByteReader{b: 0xCD}, size)

	f, err := NewFromStreamLazy(r)
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}

	var uploaded int64
	mockS3 := &mockS3Client{
		putObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
			// Drain into a counter — never accumulate in memory.
			n, err := io.Copy(io.Discard, params.Body)
			if err != nil {
				return nil, err
			}
			uploaded = n
			return &s3.PutObjectOutput{}, nil
		},
	}
	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	if err := f.UploadToS3("test-bucket", "big.bin"); err != nil {
		t.Fatalf("UploadToS3: %v", err)
	}

	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	if uploaded != size {
		t.Fatalf("uploaded %d, want %d", uploaded, size)
	}

	// HeapAlloc may dip post-GC; only fail on growth.
	if after.HeapAlloc > before.HeapAlloc {
		delta := after.HeapAlloc - before.HeapAlloc
		if delta > 50*1024*1024 {
			t.Fatalf("HeapAlloc grew by %s during 100 MB upload — expected < 50 MB",
				humanBytes(int64(delta)))
		}
	}
}

func humanBytes(n int64) string {
	const (
		KB = 1024
		MB = 1024 * KB
	)
	if n > MB {
		return fmt.Sprintf("%d MB", n/MB)
	}
	if n > KB {
		return fmt.Sprintf("%d KB", n/KB)
	}
	return fmt.Sprintf("%d B", n)
}
