package file

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Go loader for the shared lazy-streaming contract.
//
// Every port has one of these and they all read the SAME file
// (spec/lazy-stream-contract.json). Copying the numbers into this test instead
// is the drift this fixture exists to stop.

type contractCase struct {
	Name                    string `json:"name"`
	SourceBytes             int    `json:"sourceBytes"`
	LazyAfterConstruct      bool   `json:"lazyAfterConstruct"`
	SizeKnownAfterConstruct bool   `json:"sizeKnownAfterConstruct"`
	SHA256                  string `json:"sha256"`
}

type lazyContract struct {
	HeadBytes int `json:"headBytes"`
	Fill      struct {
		Pattern string `json:"pattern"`
	} `json:"fill"`
	Cases            []contractCase `json:"cases"`
	EagerConstructor struct {
		LazyAfterConstruct      bool `json:"lazyAfterConstruct"`
		SizeKnownAfterConstruct bool `json:"sizeKnownAfterConstruct"`
	} `json:"eagerConstructor"`
	FullRead struct {
		ReadCaches                    bool `json:"readCaches"`
		IterCaches                    bool `json:"iterCaches"`
		PayloadReplayedAfterIteration bool `json:"payloadReplayedAfterIteration"`
	} `json:"fullRead"`
}

func loadContract(t *testing.T) lazyContract {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "lazy-stream-contract.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var c lazyContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	if len(c.Cases) == 0 {
		t.Fatal("contract has no cases — a fixture nobody exercises is worse than none")
	}
	return c
}

func contractSource(c lazyContract, byteLength int) []byte {
	repeats := (byteLength + len(c.Fill.Pattern) - 1) / len(c.Fill.Pattern)
	return []byte(strings.Repeat(c.Fill.Pattern, repeats))[:byteLength]
}

// chunkedReader delivers the payload in small chunks, like a socket would.
type chunkedReader struct {
	payload   []byte
	offset    int
	chunkSize int
}

func (r *chunkedReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.payload) {
		return 0, io.EOF
	}
	end := r.offset + r.chunkSize
	if end > len(r.payload) {
		end = len(r.payload)
	}
	n := copy(p, r.payload[r.offset:end])
	r.offset += n
	return n, nil
}

func newChunkedReader(payload []byte) io.Reader {
	return &chunkedReader{payload: payload, chunkSize: 4096}
}

func hexSHA256(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func TestContractHeadBytes(t *testing.T) {
	c := loadContract(t)
	if streamHeadBytes != c.HeadBytes {
		t.Fatalf("streamHeadBytes = %d, contract says %d", streamHeadBytes, c.HeadBytes)
	}
}

func TestContractFixtureContentIsReproducible(t *testing.T) {
	// Positive control: without this, a broken contractSource would make every
	// assertion below compare two identically-wrong values and pass.
	c := loadContract(t)
	for _, tc := range c.Cases {
		payload := contractSource(c, tc.SourceBytes)
		if len(payload) != tc.SourceBytes {
			t.Errorf("%s: built %d bytes, want %d", tc.Name, len(payload), tc.SourceBytes)
		}
		if got := hexSHA256(payload); got != tc.SHA256 {
			t.Errorf("%s: fixture sha256 = %s, want %s", tc.Name, got, tc.SHA256)
		}
	}
}

func TestContractLazyConstructor(t *testing.T) {
	c := loadContract(t)
	for _, tc := range c.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			f, err := NewFromStreamLazy(newChunkedReader(contractSource(c, tc.SourceBytes)))
			if err != nil {
				t.Fatalf("NewFromStreamLazy: %v", err)
			}
			if f.IsLazy() != tc.LazyAfterConstruct {
				t.Errorf("IsLazy() = %v, contract says %v", f.IsLazy(), tc.LazyAfterConstruct)
			}
			// Go has no optional int64, so it answers "is this measured?" with
			// SizeKnown() where the other four ports use nil/None/undefined.
			// `Size() != 0` is NOT the same question — it is wrong for an empty file.
			if f.SizeKnown() != tc.SizeKnownAfterConstruct {
				t.Errorf("SizeKnown() = %v, contract says %v (Size() = %d)", f.SizeKnown(), tc.SizeKnownAfterConstruct, f.Size())
			}
		})
	}
}

func TestContractFullReadYieldsEveryByte(t *testing.T) {
	c := loadContract(t)
	for _, tc := range c.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			f, err := NewFromStreamLazy(newChunkedReader(contractSource(c, tc.SourceBytes)))
			if err != nil {
				t.Fatalf("NewFromStreamLazy: %v", err)
			}
			data, err := f.Read()
			if err != nil {
				t.Fatalf("Read: %v", err)
			}
			if len(data) != tc.SourceBytes {
				t.Errorf("read %d bytes, want %d", len(data), tc.SourceBytes)
			}
			if got := hexSHA256(data); got != tc.SHA256 {
				t.Errorf("sha256 = %s, want %s", got, tc.SHA256)
			}
		})
	}
}

func TestContractIterationYieldsEveryByte(t *testing.T) {
	c := loadContract(t)
	for _, tc := range c.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			f, err := NewFromStreamLazy(newChunkedReader(contractSource(c, tc.SourceBytes)))
			if err != nil {
				t.Fatalf("NewFromStreamLazy: %v", err)
			}

			digest := sha256.New()
			total := 0
			chunks, errc := f.IterBytes(context.Background())
			for chunk := range chunks {
				digest.Write(chunk)
				total += len(chunk)
			}
			if err := <-errc; err != nil {
				t.Fatalf("IterBytes: %v", err)
			}

			if total != tc.SourceBytes {
				t.Errorf("iterated %d bytes, want %d", total, tc.SourceBytes)
			}
			if got := hex.EncodeToString(digest.Sum(nil)); got != tc.SHA256 {
				t.Errorf("sha256 = %s, want %s", got, tc.SHA256)
			}
		})
	}
}

func TestContractEagerConstructorBuffersEverything(t *testing.T) {
	c := loadContract(t)
	for _, tc := range c.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			f, err := NewFromStream(newChunkedReader(contractSource(c, tc.SourceBytes)))
			if err != nil {
				t.Fatalf("NewFromStream: %v", err)
			}
			if f.IsLazy() != c.EagerConstructor.LazyAfterConstruct {
				t.Errorf("IsLazy() = %v, contract says %v", f.IsLazy(), c.EagerConstructor.LazyAfterConstruct)
			}
			if f.SizeKnown() != c.EagerConstructor.SizeKnownAfterConstruct {
				t.Errorf("SizeKnown() = %v, contract says %v", f.SizeKnown(), c.EagerConstructor.SizeKnownAfterConstruct)
			}
			if f.Size() != int64(tc.SourceBytes) {
				t.Errorf("Size() = %d, want %d", f.Size(), tc.SourceBytes)
			}
		})
	}
}

func TestContractReadCachesAndIterationDoesNot(t *testing.T) {
	c := loadContract(t)
	if !c.FullRead.ReadCaches || c.FullRead.IterCaches {
		t.Fatalf("contract changed: readCaches=%v iterCaches=%v", c.FullRead.ReadCaches, c.FullRead.IterCaches)
	}
	tc := c.Cases[len(c.Cases)-1]
	payload := contractSource(c, tc.SourceBytes)

	cached, err := NewFromStreamLazy(newChunkedReader(payload))
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}
	first, err := cached.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	second, err := cached.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(first, second) || hexSHA256(second) != tc.SHA256 {
		t.Error("a second Read() did not return the cached payload")
	}

	consumed, err := NewFromStreamLazy(newChunkedReader(payload))
	if err != nil {
		t.Fatalf("NewFromStreamLazy: %v", err)
	}
	chunks, errc := consumed.IterBytes(context.Background())
	for range chunks {
	}
	if err := <-errc; err != nil {
		t.Fatalf("IterBytes: %v", err)
	}
	// The contract pins that the payload is never silently replayed. Go reports
	// the drained tail as an error where the other four return an empty buffer —
	// a divergence the fixture names rather than hides.
	leftovers, err := consumed.Read()
	if c.FullRead.PayloadReplayedAfterIteration {
		t.Fatal("contract changed: payloadReplayedAfterIteration is now true")
	}
	if err == nil && len(leftovers) != 0 {
		t.Errorf("Read() after a full iteration replayed %d bytes; the tail is gone", len(leftovers))
	}
}
