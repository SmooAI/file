package file

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestIntegration_URLToFileRoundTrip downloads a file from an httptest server,
// saves it to disk, re-reads it, verifies content and checksums match.
func TestIntegration_URLToFileRoundTrip(t *testing.T) {
	content := []byte("Integration test content for round-trip verification.")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Disposition", `attachment; filename="roundtrip.txt"`)
		w.Write(content)
	}))
	defer srv.Close()

	cleanup := setMockHTTP(srv.Client())
	defer cleanup()

	// Step 1: Download from URL.
	urlFile, err := NewFromURL(srv.URL + "/roundtrip.txt")
	if err != nil {
		t.Fatalf("NewFromURL error: %v", err)
	}

	if urlFile.Name() != "roundtrip.txt" {
		t.Errorf("Name() = %q, want %q", urlFile.Name(), "roundtrip.txt")
	}

	urlData, err := urlFile.Read()
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if !bytes.Equal(urlData, content) {
		t.Error("downloaded content does not match original")
	}

	// Step 2: Save to disk.
	dir := t.TempDir()
	savedPath := filepath.Join(dir, "saved.txt")
	savedFile, err := urlFile.Save(savedPath)
	if err != nil {
		t.Fatalf("Save error: %v", err)
	}

	// Step 3: Re-read from disk.
	diskFile, err := NewFromFile(savedPath)
	if err != nil {
		t.Fatalf("NewFromFile error: %v", err)
	}

	diskData, err := diskFile.Read()
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if !bytes.Equal(diskData, content) {
		t.Error("disk content does not match original")
	}

	// Step 4: Checksums match.
	urlChecksum, _ := urlFile.Checksum()
	savedChecksum, _ := savedFile.Checksum()
	diskChecksum, _ := diskFile.Checksum()

	expected := sha256.Sum256(content)
	expectedHex := hex.EncodeToString(expected[:])

	if urlChecksum != expectedHex {
		t.Errorf("URL checksum = %q, want %q", urlChecksum, expectedHex)
	}
	if savedChecksum != expectedHex {
		t.Errorf("Saved checksum = %q, want %q", savedChecksum, expectedHex)
	}
	if diskChecksum != expectedHex {
		t.Errorf("Disk checksum = %q, want %q", diskChecksum, expectedHex)
	}
}

// TestIntegration_BytesToStreamRoundTrip creates a file from bytes, reads it
// as a stream, and verifies the content.
func TestIntegration_BytesToStreamRoundTrip(t *testing.T) {
	content := []byte("Bytes to stream round-trip test")

	// Create from bytes.
	bytesFile, err := NewFromBytes(content, MetadataHint{Name: "bytes.txt"})
	if err != nil {
		t.Fatalf("NewFromBytes error: %v", err)
	}

	// Read and create from stream.
	data, err := bytesFile.Read()
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}

	streamFile, err := NewFromStream(bytes.NewReader(data), MetadataHint{Name: "stream.txt"})
	if err != nil {
		t.Fatalf("NewFromStream error: %v", err)
	}

	streamData, err := streamFile.Read()
	if err != nil {
		t.Fatalf("Read from stream error: %v", err)
	}

	if !bytes.Equal(streamData, content) {
		t.Error("stream content does not match original bytes")
	}

	// Verify sizes match.
	if bytesFile.Size() != streamFile.Size() {
		t.Errorf("sizes differ: bytes=%d, stream=%d", bytesFile.Size(), streamFile.Size())
	}
}

// TestIntegration_FileAppendPrependTruncate tests sequential file modifications.
func TestIntegration_FileAppendPrependTruncate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "modify.txt")
	os.WriteFile(p, []byte("middle"), 0o644)

	f, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}

	// Append.
	if err := f.Append([]byte(" end")); err != nil {
		t.Fatalf("Append error: %v", err)
	}
	text, _ := f.ReadText()
	if text != "middle end" {
		t.Errorf("after Append: %q, want %q", text, "middle end")
	}

	// Prepend.
	if err := f.Prepend([]byte("start ")); err != nil {
		t.Fatalf("Prepend error: %v", err)
	}
	text, _ = f.ReadText()
	if text != "start middle end" {
		t.Errorf("after Prepend: %q, want %q", text, "start middle end")
	}

	// Truncate to "start mi" (8 bytes).
	if err := f.Truncate(8); err != nil {
		t.Fatalf("Truncate error: %v", err)
	}
	text, _ = f.ReadText()
	if text != "start mi" {
		t.Errorf("after Truncate(8): %q, want %q", text, "start mi")
	}

	if f.Size() != 8 {
		t.Errorf("Size() = %d, want 8", f.Size())
	}
}

// TestIntegration_SaveAndMoveFromBytes tests saving bytes to disk, then moving.
func TestIntegration_SaveAndMoveFromBytes(t *testing.T) {
	dir := t.TempDir()
	data := []byte("portable data")

	f, err := NewFromBytes(data, MetadataHint{Name: "portable.txt"})
	if err != nil {
		t.Fatal(err)
	}

	// Save.
	savePath := filepath.Join(dir, "first.txt")
	saved, err := f.Save(savePath)
	if err != nil {
		t.Fatalf("Save error: %v", err)
	}

	// Move from saved location.
	movePath := filepath.Join(dir, "second.txt")
	moved, err := saved.Move(movePath)
	if err != nil {
		t.Fatalf("Move error: %v", err)
	}

	// First should be gone, second should exist.
	if _, err := os.Stat(savePath); !os.IsNotExist(err) {
		t.Error("first file should be gone after Move")
	}

	movedData, _ := os.ReadFile(movePath)
	if !bytes.Equal(movedData, data) {
		t.Error("moved file content mismatch")
	}
	if moved.Path() != movePath {
		t.Errorf("moved Path() = %q, want %q", moved.Path(), movePath)
	}
}

// TestIntegration_PNG_MimeDetection verifies that a file with PNG magic bytes
// is correctly detected across different constructors.
func TestIntegration_PNG_MimeDetection(t *testing.T) {
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52}

	// From bytes.
	bf, err := NewFromBytes(pngHeader)
	if err != nil {
		t.Fatal(err)
	}
	if bf.MimeType() != "image/png" {
		t.Errorf("bytes MimeType = %q, want image/png", bf.MimeType())
	}
	if bf.Extension() != "png" {
		t.Errorf("bytes Extension = %q, want png", bf.Extension())
	}

	// From file.
	dir := t.TempDir()
	p := filepath.Join(dir, "test.dat") // intentionally no .png extension
	os.WriteFile(p, pngHeader, 0o644)

	ff, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if ff.MimeType() != "image/png" {
		t.Errorf("file MimeType = %q, want image/png", ff.MimeType())
	}
	if ff.Extension() != "png" {
		t.Errorf("file Extension = %q, want png", ff.Extension())
	}

	// From stream.
	sf, err := NewFromStream(bytes.NewReader(pngHeader))
	if err != nil {
		t.Fatal(err)
	}
	if sf.MimeType() != "image/png" {
		t.Errorf("stream MimeType = %q, want image/png", sf.MimeType())
	}
	if sf.Extension() != "png" {
		t.Errorf("stream Extension = %q, want png", sf.Extension())
	}

	// From URL.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(pngHeader)
	}))
	defer srv.Close()

	httpCleanup := setMockHTTP(srv.Client())
	defer httpCleanup()

	uf, err := NewFromURL(srv.URL + "/image.png")
	if err != nil {
		t.Fatal(err)
	}
	if uf.MimeType() != "image/png" {
		t.Errorf("url MimeType = %q, want image/png", uf.MimeType())
	}
	if uf.Extension() != "png" {
		t.Errorf("url Extension = %q, want png", uf.Extension())
	}
}

// TestIntegration_MetadataFromHTTPHeaders tests that all HTTP response headers
// are properly extracted into metadata.
func TestIntegration_MetadataFromHTTPHeaders(t *testing.T) {
	pdfContent := []byte("%PDF-1.4 some content here enough bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="report.pdf"`)
		w.Header().Set("ETag", `"hash123"`)
		w.Header().Set("Last-Modified", "Tue, 02 Jan 2024 03:04:05 GMT")
		w.Write(pdfContent)
	}))
	defer srv.Close()

	cleanup := setMockHTTP(srv.Client())
	defer cleanup()

	f, err := NewFromURL(srv.URL + "/report.pdf")
	if err != nil {
		t.Fatal(err)
	}

	if f.Name() != "report.pdf" {
		t.Errorf("Name() = %q, want %q", f.Name(), "report.pdf")
	}
	if f.MimeType() != "application/pdf" {
		t.Errorf("MimeType() = %q, want %q", f.MimeType(), "application/pdf")
	}
	if f.Size() != int64(len(pdfContent)) {
		t.Errorf("Size() = %d, want %d", f.Size(), len(pdfContent))
	}
	if f.Hash() != "hash123" {
		t.Errorf("Hash() = %q, want %q", f.Hash(), "hash123")
	}
	if f.Extension() != "pdf" {
		t.Errorf("Extension() = %q, want %q", f.Extension(), "pdf")
	}
	if f.LastModified().IsZero() {
		t.Error("LastModified() should not be zero")
	}
}
