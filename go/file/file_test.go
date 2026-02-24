package file

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// --- Mock S3 client ---

type mockS3Client struct {
	getObjectFn    func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	putObjectFn    func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	deleteObjectFn func(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

func (m *mockS3Client) GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	if m.getObjectFn != nil {
		return m.getObjectFn(ctx, params, optFns...)
	}
	return nil, fmt.Errorf("mock: GetObject not implemented")
}

func (m *mockS3Client) PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	if m.putObjectFn != nil {
		return m.putObjectFn(ctx, params, optFns...)
	}
	return nil, fmt.Errorf("mock: PutObject not implemented")
}

func (m *mockS3Client) DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	if m.deleteObjectFn != nil {
		return m.deleteObjectFn(ctx, params, optFns...)
	}
	return nil, fmt.Errorf("mock: DeleteObject not implemented")
}

// --- Mock presign client ---

type mockPresignClient struct {
	presignGetObjectFn func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

func (m *mockPresignClient) PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	if m.presignGetObjectFn != nil {
		return m.presignGetObjectFn(ctx, params, optFns...)
	}
	return nil, fmt.Errorf("mock: PresignGetObject not implemented")
}

// setMockS3 replaces the S3ClientFactory with a mock and returns a cleanup function.
func setMockS3(s3c *mockS3Client, presign *mockPresignClient) func() {
	orig := S3ClientFactory
	S3ClientFactory = func() (S3API, S3PresignAPI) {
		return s3c, presign
	}
	return func() { S3ClientFactory = orig }
}

// setMockHTTP replaces the HTTPClient with the given httptest server's client and returns cleanup.
func setMockHTTP(client *http.Client) func() {
	orig := HTTPClient
	HTTPClient = client
	return func() { HTTPClient = orig }
}

// --- TestNewFromURL ---

func TestNewFromURL(t *testing.T) {
	tests := []struct {
		name       string
		handler    http.HandlerFunc
		hints      []MetadataHint
		wantName   string
		wantMime   string
		wantSize   int64
		wantSource FileSource
		wantErr    bool
	}{
		{
			name: "basic text file from URL",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/plain")
				w.Header().Set("Content-Disposition", `attachment; filename="hello.txt"`)
				w.Header().Set("Content-Length", "13")
				fmt.Fprint(w, "Hello, World!")
			},
			wantName:   "hello.txt",
			wantMime:   "text/plain; charset=utf-8", // magic-byte detection adds charset
			wantSize:   13,
			wantSource: SourceURL,
		},
		{
			name: "URL with hints name override",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/octet-stream")
				// Note: Go httptest auto-sets Content-Length from body.
				fmt.Fprint(w, "data")
			},
			hints:      []MetadataHint{{Name: "custom.bin"}},
			wantName:   "custom.bin",
			wantMime:   "text/plain; charset=utf-8", // magic-byte detects text
			wantSize:   4,                            // Content-Length from response takes precedence
			wantSource: SourceURL,
		},
		{
			name: "server returns 404",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(404)
			},
			wantErr: true,
		},
		{
			name: "response with ETag and Last-Modified",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/plain")
				w.Header().Set("ETag", `"abc123"`)
				w.Header().Set("Last-Modified", "Mon, 01 Jan 2024 00:00:00 GMT")
				w.Header().Set("Content-Length", "5")
				fmt.Fprint(w, "hello")
			},
			wantMime:   "text/plain; charset=utf-8", // magic-byte adds charset
			wantSize:   5,
			wantSource: SourceURL,
		},
		{
			name: "PNG content from URL",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "image/png")
				w.Header().Set("Content-Disposition", `attachment; filename="image.png"`)
				// Write PNG header bytes.
				w.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52})
			},
			wantName:   "image.png",
			wantMime:   "image/png",
			wantSource: SourceURL,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(tt.handler)
			defer srv.Close()
			cleanup := setMockHTTP(srv.Client())
			defer cleanup()

			f, err := NewFromURL(srv.URL+"/test-file.txt", tt.hints...)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if f.Source() != tt.wantSource {
				t.Errorf("Source() = %q, want %q", f.Source(), tt.wantSource)
			}
			if tt.wantName != "" && f.Name() != tt.wantName {
				t.Errorf("Name() = %q, want %q", f.Name(), tt.wantName)
			}
			if tt.wantMime != "" && f.MimeType() != tt.wantMime {
				t.Errorf("MimeType() = %q, want %q", f.MimeType(), tt.wantMime)
			}
			if tt.wantSize != 0 && f.Size() != tt.wantSize {
				t.Errorf("Size() = %d, want %d", f.Size(), tt.wantSize)
			}
		})
	}
}

func TestNewFromURL_InvalidURL(t *testing.T) {
	_, err := NewFromURL("://invalid")
	if err == nil {
		t.Fatal("expected error for invalid URL")
	}
	if !errors.Is(err, ErrHTTP) {
		t.Errorf("expected ErrHTTP, got %v", err)
	}
}

// --- TestNewFromBytes ---

func TestNewFromBytes(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		hints    []MetadataHint
		wantSize int64
		wantName string
	}{
		{
			name:     "empty bytes",
			data:     []byte{},
			wantSize: 0,
		},
		{
			name:     "simple text bytes",
			data:     []byte("Hello"),
			wantSize: 5,
		},
		{
			name:     "bytes with name hint",
			data:     []byte("content"),
			hints:    []MetadataHint{{Name: "readme.txt"}},
			wantSize: 7,
			wantName: "readme.txt",
		},
		{
			name:     "PNG bytes",
			data:     []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			wantSize: 16,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := NewFromBytes(tt.data, tt.hints...)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if f.Source() != SourceBytes {
				t.Errorf("Source() = %q, want %q", f.Source(), SourceBytes)
			}
			if f.Size() != tt.wantSize {
				t.Errorf("Size() = %d, want %d", f.Size(), tt.wantSize)
			}
			if tt.wantName != "" && f.Name() != tt.wantName {
				t.Errorf("Name() = %q, want %q", f.Name(), tt.wantName)
			}
		})
	}
}

// --- TestNewFromFile ---

func TestNewFromFile(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name     string
		setup    func() string // returns file path
		hints    []MetadataHint
		wantName string
		wantSize int64
		wantErr  bool
	}{
		{
			name: "text file",
			setup: func() string {
				p := filepath.Join(dir, "test.txt")
				os.WriteFile(p, []byte("hello world"), 0o644)
				return p
			},
			wantName: "test.txt",
			wantSize: 11,
		},
		{
			name: "non-existent file",
			setup: func() string {
				return filepath.Join(dir, "nonexistent.txt")
			},
			wantErr: true,
		},
		{
			name: "file with hint name",
			setup: func() string {
				p := filepath.Join(dir, "data.bin")
				os.WriteFile(p, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52}, 0o644)
				return p
			},
			hints:    []MetadataHint{{Name: "photo.png"}},
			wantName: "photo.png",
			wantSize: 16,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := tt.setup()
			f, err := NewFromFile(p, tt.hints...)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if f.Source() != SourceFile {
				t.Errorf("Source() = %q, want %q", f.Source(), SourceFile)
			}
			if f.Name() != tt.wantName {
				t.Errorf("Name() = %q, want %q", f.Name(), tt.wantName)
			}
			if f.Size() != tt.wantSize {
				t.Errorf("Size() = %d, want %d", f.Size(), tt.wantSize)
			}
			if f.Path() != p {
				t.Errorf("Path() = %q, want %q", f.Path(), p)
			}
		})
	}
}

func TestNewFromFile_NotFound(t *testing.T) {
	_, err := NewFromFile("/this/path/does/not/exist.txt")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

// --- TestNewFromStream ---

func TestNewFromStream(t *testing.T) {
	data := []byte("stream content here")
	r := bytes.NewReader(data)

	f, err := NewFromStream(r, MetadataHint{Name: "streamed.txt"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if f.Source() != SourceStream {
		t.Errorf("Source() = %q, want %q", f.Source(), SourceStream)
	}
	if f.Name() != "streamed.txt" {
		t.Errorf("Name() = %q, want %q", f.Name(), "streamed.txt")
	}
	if f.Size() != int64(len(data)) {
		t.Errorf("Size() = %d, want %d", f.Size(), len(data))
	}

	text, err := f.ReadText()
	if err != nil {
		t.Fatalf("ReadText() error: %v", err)
	}
	if text != "stream content here" {
		t.Errorf("ReadText() = %q, want %q", text, "stream content here")
	}
}

// --- TestNewFromS3 ---

func TestNewFromS3(t *testing.T) {
	lastMod := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	mockS3 := &mockS3Client{
		getObjectFn: func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
			if *params.Bucket != "test-bucket" || *params.Key != "path/to/file.txt" {
				return nil, fmt.Errorf("unexpected bucket/key: %s/%s", *params.Bucket, *params.Key)
			}
			ct := "text/plain"
			etag := `"abcdef123456"`
			var cl int64 = 11
			return &s3.GetObjectOutput{
				Body:          io.NopCloser(strings.NewReader("hello world")),
				ContentType:   &ct,
				ContentLength: &cl,
				ETag:          &etag,
				LastModified:  &lastMod,
			}, nil
		},
	}

	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	f, err := NewFromS3("test-bucket", "path/to/file.txt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if f.Source() != SourceS3 {
		t.Errorf("Source() = %q, want %q", f.Source(), SourceS3)
	}
	if f.Name() != "file.txt" {
		t.Errorf("Name() = %q, want %q", f.Name(), "file.txt")
	}
	// Magic-byte detection overrides the S3 ContentType header with charset info.
	if f.MimeType() != "text/plain; charset=utf-8" {
		t.Errorf("MimeType() = %q, want %q", f.MimeType(), "text/plain; charset=utf-8")
	}
	if f.Size() != 11 {
		t.Errorf("Size() = %d, want 11", f.Size())
	}
	if f.Hash() != "abcdef123456" {
		t.Errorf("Hash() = %q, want %q", f.Hash(), "abcdef123456")
	}
	if !f.LastModified().Equal(lastMod) {
		t.Errorf("LastModified() = %v, want %v", f.LastModified(), lastMod)
	}
	if f.URL() != "s3://test-bucket/path/to/file.txt" {
		t.Errorf("URL() = %q, want %q", f.URL(), "s3://test-bucket/path/to/file.txt")
	}

	text, err := f.ReadText()
	if err != nil {
		t.Fatalf("ReadText() error: %v", err)
	}
	if text != "hello world" {
		t.Errorf("ReadText() = %q, want %q", text, "hello world")
	}
}

func TestNewFromS3_Error(t *testing.T) {
	mockS3 := &mockS3Client{
		getObjectFn: func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
			return nil, fmt.Errorf("access denied")
		},
	}

	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	_, err := NewFromS3("bucket", "key")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrS3) {
		t.Errorf("expected ErrS3, got %v", err)
	}
}

// --- TestRead / ReadText ---

func TestRead(t *testing.T) {
	content := []byte("file contents")
	f, err := NewFromBytes(content)
	if err != nil {
		t.Fatal(err)
	}

	got, err := f.Read()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Errorf("Read() = %q, want %q", got, content)
	}
}

func TestReadText(t *testing.T) {
	f, err := NewFromBytes([]byte("hello"))
	if err != nil {
		t.Fatal(err)
	}

	text, err := f.ReadText()
	if err != nil {
		t.Fatal(err)
	}
	if text != "hello" {
		t.Errorf("ReadText() = %q, want %q", text, "hello")
	}
}

// --- TestSave ---

func TestSave(t *testing.T) {
	dir := t.TempDir()
	content := []byte("save me")
	f, _ := NewFromBytes(content, MetadataHint{Name: "save.txt"})

	destPath := filepath.Join(dir, "output", "saved.txt")
	newFile, err := f.Save(destPath)
	if err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	if newFile.Source() != SourceFile {
		t.Errorf("saved file Source() = %q, want %q", newFile.Source(), SourceFile)
	}
	if newFile.Path() != destPath {
		t.Errorf("saved file Path() = %q, want %q", newFile.Path(), destPath)
	}

	// Verify content on disk.
	data, err := os.ReadFile(destPath)
	if err != nil {
		t.Fatalf("ReadFile() error: %v", err)
	}
	if !bytes.Equal(data, content) {
		t.Errorf("saved content = %q, want %q", data, content)
	}
}

// --- TestMove ---

func TestMove(t *testing.T) {
	dir := t.TempDir()

	// Create a source file.
	srcPath := filepath.Join(dir, "source.txt")
	os.WriteFile(srcPath, []byte("move me"), 0o644)

	f, err := NewFromFile(srcPath)
	if err != nil {
		t.Fatal(err)
	}

	destPath := filepath.Join(dir, "moved.txt")
	moved, err := f.Move(destPath)
	if err != nil {
		t.Fatalf("Move() error: %v", err)
	}

	// Original should be gone.
	if _, err := os.Stat(srcPath); !os.IsNotExist(err) {
		t.Error("expected source file to be removed after Move()")
	}

	// Destination should exist.
	data, err := os.ReadFile(destPath)
	if err != nil {
		t.Fatalf("could not read destination file: %v", err)
	}
	if string(data) != "move me" {
		t.Errorf("moved content = %q, want %q", data, "move me")
	}
	if moved.Path() != destPath {
		t.Errorf("moved Path() = %q, want %q", moved.Path(), destPath)
	}
}

func TestMove_NonFileSouce(t *testing.T) {
	dir := t.TempDir()
	f, _ := NewFromBytes([]byte("data"))
	destPath := filepath.Join(dir, "moved.txt")
	moved, err := f.Move(destPath)
	if err != nil {
		t.Fatalf("Move() error: %v", err)
	}
	// Should save without removing anything.
	if moved.Path() != destPath {
		t.Errorf("moved Path() = %q, want %q", moved.Path(), destPath)
	}
}

// --- TestDelete ---

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "delete-me.txt")
	os.WriteFile(p, []byte("bye"), 0o644)

	f, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}

	if err := f.Delete(); err != nil {
		t.Fatalf("Delete() error: %v", err)
	}

	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Error("file should be deleted")
	}
}

func TestDelete_NonFileSource(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"))
	err := f.Delete()
	if err == nil {
		t.Fatal("expected error deleting non-file source")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

// --- TestChecksum ---

func TestChecksum(t *testing.T) {
	data := []byte("checksum this content")
	expected := sha256.Sum256(data)
	expectedHex := hex.EncodeToString(expected[:])

	f, _ := NewFromBytes(data)
	got, err := f.Checksum()
	if err != nil {
		t.Fatalf("Checksum() error: %v", err)
	}
	if got != expectedHex {
		t.Errorf("Checksum() = %q, want %q", got, expectedHex)
	}
}

// --- TestUploadToS3 ---

func TestUploadToS3(t *testing.T) {
	var capturedBucket, capturedKey string
	var capturedBody []byte
	var capturedContentType *string

	mockS3 := &mockS3Client{
		putObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
			capturedBucket = *params.Bucket
			capturedKey = *params.Key
			capturedContentType = params.ContentType
			var err error
			capturedBody, err = io.ReadAll(params.Body)
			if err != nil {
				return nil, err
			}
			return &s3.PutObjectOutput{}, nil
		},
	}

	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	f, _ := NewFromBytes([]byte("upload me"), MetadataHint{Name: "upload.txt", MimeType: "text/plain"})

	err := f.UploadToS3("dest-bucket", "uploads/upload.txt")
	if err != nil {
		t.Fatalf("UploadToS3() error: %v", err)
	}

	if capturedBucket != "dest-bucket" {
		t.Errorf("bucket = %q, want %q", capturedBucket, "dest-bucket")
	}
	if capturedKey != "uploads/upload.txt" {
		t.Errorf("key = %q, want %q", capturedKey, "uploads/upload.txt")
	}
	if string(capturedBody) != "upload me" {
		t.Errorf("body = %q, want %q", capturedBody, "upload me")
	}
	// Magic-byte detection adds charset parameter to text/plain.
	if capturedContentType == nil || *capturedContentType != "text/plain; charset=utf-8" {
		ct := ""
		if capturedContentType != nil {
			ct = *capturedContentType
		}
		t.Errorf("ContentType = %q, want %q", ct, "text/plain; charset=utf-8")
	}
}

func TestUploadToS3_Error(t *testing.T) {
	mockS3 := &mockS3Client{
		putObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
			return nil, fmt.Errorf("permission denied")
		},
	}

	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	f, _ := NewFromBytes([]byte("fail"))
	err := f.UploadToS3("bucket", "key")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrS3) {
		t.Errorf("expected ErrS3, got %v", err)
	}
}

// --- TestDownloadFromS3 ---

func TestDownloadFromS3(t *testing.T) {
	mockS3 := &mockS3Client{
		getObjectFn: func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
			ct := "text/plain"
			var cl int64 = 7
			return &s3.GetObjectOutput{
				Body:          io.NopCloser(strings.NewReader("updated")),
				ContentType:   &ct,
				ContentLength: &cl,
			}, nil
		},
	}

	cleanup := setMockS3(mockS3, &mockPresignClient{})
	defer cleanup()

	f, _ := NewFromBytes([]byte("old"))
	err := f.DownloadFromS3("bucket", "key")
	if err != nil {
		t.Fatalf("DownloadFromS3() error: %v", err)
	}

	if f.Source() != SourceS3 {
		t.Errorf("Source() after download = %q, want %q", f.Source(), SourceS3)
	}
	text, _ := f.ReadText()
	if text != "updated" {
		t.Errorf("ReadText() = %q, want %q", text, "updated")
	}
}

// --- TestGetSignedURL ---

func TestGetSignedURL(t *testing.T) {
	mockPresign := &mockPresignClient{
		presignGetObjectFn: func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
			if *params.Bucket != "my-bucket" || *params.Key != "docs/report.pdf" {
				return nil, fmt.Errorf("unexpected bucket/key")
			}
			return &v4.PresignedHTTPRequest{
				URL:    "https://my-bucket.s3.amazonaws.com/docs/report.pdf?signed=true",
				Method: "GET",
			}, nil
		},
	}

	cleanup := setMockS3(&mockS3Client{
		getObjectFn: func(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
			ct := "application/pdf"
			return &s3.GetObjectOutput{
				Body:        io.NopCloser(strings.NewReader("")),
				ContentType: &ct,
			}, nil
		},
	}, mockPresign)
	defer cleanup()

	f, err := NewFromS3("my-bucket", "docs/report.pdf")
	if err != nil {
		t.Fatalf("NewFromS3() error: %v", err)
	}

	signedURL, err := f.GetSignedURL(1 * time.Hour)
	if err != nil {
		t.Fatalf("GetSignedURL() error: %v", err)
	}
	if !strings.Contains(signedURL, "signed=true") {
		t.Errorf("GetSignedURL() = %q, expected it to contain 'signed=true'", signedURL)
	}
}

func TestGetSignedURL_NotS3(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"))
	_, err := f.GetSignedURL(1 * time.Hour)
	if err == nil {
		t.Fatal("expected error for non-S3 file")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

// --- TestAppend ---

func TestAppend(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "append.txt")
	os.WriteFile(p, []byte("start"), 0o644)

	f, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}

	if err := f.Append([]byte(" end")); err != nil {
		t.Fatalf("Append() error: %v", err)
	}

	data, _ := os.ReadFile(p)
	if string(data) != "start end" {
		t.Errorf("after Append, file content = %q, want %q", data, "start end")
	}

	// Metadata should be refreshed.
	if f.Size() != 9 {
		t.Errorf("Size() after Append = %d, want 9", f.Size())
	}
}

func TestAppend_NonFileSource(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"))
	err := f.Append([]byte("more"))
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

// --- TestPrepend ---

func TestPrepend(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "prepend.txt")
	os.WriteFile(p, []byte("end"), 0o644)

	f, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}

	if err := f.Prepend([]byte("start ")); err != nil {
		t.Fatalf("Prepend() error: %v", err)
	}

	data, _ := os.ReadFile(p)
	if string(data) != "start end" {
		t.Errorf("after Prepend, file content = %q, want %q", data, "start end")
	}
}

func TestPrepend_NonFileSource(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"))
	err := f.Prepend([]byte("prefix"))
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

// --- TestTruncate ---

func TestTruncate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "trunc.txt")
	os.WriteFile(p, []byte("hello world"), 0o644)

	f, err := NewFromFile(p)
	if err != nil {
		t.Fatal(err)
	}

	if err := f.Truncate(5); err != nil {
		t.Fatalf("Truncate() error: %v", err)
	}

	data, _ := os.ReadFile(p)
	if string(data) != "hello" {
		t.Errorf("after Truncate(5), file content = %q, want %q", data, "hello")
	}

	if f.Size() != 5 {
		t.Errorf("Size() after Truncate = %d, want 5", f.Size())
	}
}

func TestTruncate_NonFileSource(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"))
	err := f.Truncate(2)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

// --- TestSetMetadata ---

func TestSetMetadata(t *testing.T) {
	f, _ := NewFromBytes([]byte("data"), MetadataHint{Name: "original.txt"})

	f.SetMetadata(MetadataHint{Name: "updated.txt", MimeType: "text/html"})
	if f.Name() != "updated.txt" {
		t.Errorf("Name() = %q, want %q", f.Name(), "updated.txt")
	}
	if f.MimeType() != "text/html" {
		t.Errorf("MimeType() = %q, want %q", f.MimeType(), "text/html")
	}
}

// --- TestString ---

func TestString(t *testing.T) {
	f, _ := NewFromBytes([]byte("test"), MetadataHint{Name: "test.txt", MimeType: "text/plain"})
	s := f.String()
	if !strings.Contains(s, "test.txt") {
		t.Errorf("String() = %q, expected to contain 'test.txt'", s)
	}
	if !strings.Contains(s, "Bytes") {
		t.Errorf("String() = %q, expected to contain 'Bytes'", s)
	}
}

// --- TestFileSource ---

func TestFileSource_String(t *testing.T) {
	if SourceURL.String() != "Url" {
		t.Errorf("SourceURL.String() = %q, want %q", SourceURL.String(), "Url")
	}
}

func TestFileSource_Valid(t *testing.T) {
	tests := []struct {
		source FileSource
		want   bool
	}{
		{SourceURL, true},
		{SourceBytes, true},
		{SourceFile, true},
		{SourceStream, true},
		{SourceS3, true},
		{FileSource("Unknown"), false},
	}

	for _, tt := range tests {
		t.Run(string(tt.source), func(t *testing.T) {
			if got := tt.source.Valid(); got != tt.want {
				t.Errorf("Valid() = %v, want %v", got, tt.want)
			}
		})
	}
}

// --- TestFileError ---

func TestFileError_Is(t *testing.T) {
	err := newError(ErrS3, "TestOp", fmt.Errorf("underlying"))
	if !errors.Is(err, ErrS3) {
		t.Error("expected errors.Is(err, ErrS3) = true")
	}
	if errors.Is(err, ErrNotFound) {
		t.Error("expected errors.Is(err, ErrNotFound) = false")
	}
}

func TestFileError_Unwrap(t *testing.T) {
	underlying := fmt.Errorf("root cause")
	err := newError(ErrRead, "TestOp", underlying)
	if !errors.Is(err, underlying) {
		t.Error("expected Unwrap to expose the underlying error")
	}
}

func TestFileError_String(t *testing.T) {
	err := newError(ErrHTTP, "NewFromURL", fmt.Errorf("status 404"))
	s := err.Error()
	if !strings.Contains(s, "NewFromURL") {
		t.Errorf("error string %q should contain the op name", s)
	}
	if !strings.Contains(s, "status 404") {
		t.Errorf("error string %q should contain the underlying error", s)
	}
}

// --- Test helpers ---

func TestFilenameFromURL(t *testing.T) {
	tests := []struct {
		rawURL string
		want   string
	}{
		{"https://example.com/files/report.pdf", "report.pdf"},
		{"https://example.com/", ""},
		{"https://example.com", ""},
		{"", ""},
		{"not a valid url ://", ""},
		{"https://example.com/path/to/image.png?v=123", "image.png"},
	}

	for _, tt := range tests {
		t.Run(tt.rawURL, func(t *testing.T) {
			got := filenameFromURL(tt.rawURL)
			if got != tt.want {
				t.Errorf("filenameFromURL(%q) = %q, want %q", tt.rawURL, got, tt.want)
			}
		})
	}
}

func TestParseS3URI(t *testing.T) {
	tests := []struct {
		uri        string
		wantBucket string
		wantKey    string
		wantOk     bool
	}{
		{"s3://mybucket/path/to/file.txt", "mybucket", "path/to/file.txt", true},
		{"s3://bucket/key", "bucket", "key", true},
		{"s3://bucket", "bucket", "", false},
		{"https://not-s3.com/file", "", "", false},
		{"", "", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.uri, func(t *testing.T) {
			bucket, key, ok := parseS3URI(tt.uri)
			if bucket != tt.wantBucket || key != tt.wantKey || ok != tt.wantOk {
				t.Errorf("parseS3URI(%q) = (%q, %q, %v), want (%q, %q, %v)",
					tt.uri, bucket, key, ok, tt.wantBucket, tt.wantKey, tt.wantOk)
			}
		})
	}
}

// --- Test MetadataHint helpers ---

func TestMetadataHint_Has(t *testing.T) {
	h := MetadataHint{}
	if h.hasName() {
		t.Error("empty hint should not hasName")
	}
	if h.hasMimeType() {
		t.Error("empty hint should not hasMimeType")
	}
	if h.hasSize() {
		t.Error("empty hint should not hasSize")
	}
	if h.hasExtension() {
		t.Error("empty hint should not hasExtension")
	}
	if h.hasURL() {
		t.Error("empty hint should not hasURL")
	}
	if h.hasPath() {
		t.Error("empty hint should not hasPath")
	}
	if h.hasHash() {
		t.Error("empty hint should not hasHash")
	}
	if h.hasLastModified() {
		t.Error("empty hint should not hasLastModified")
	}
	if h.hasCreatedAt() {
		t.Error("empty hint should not hasCreatedAt")
	}

	h2 := MetadataHint{
		Name:         "a",
		MimeType:     "b",
		Size:         1,
		Extension:    "c",
		URL:          "d",
		Path:         "e",
		Hash:         "f",
		LastModified: time.Now(),
		CreatedAt:    time.Now(),
	}
	if !h2.hasName() || !h2.hasMimeType() || !h2.hasSize() || !h2.hasExtension() ||
		!h2.hasURL() || !h2.hasPath() || !h2.hasHash() || !h2.hasLastModified() || !h2.hasCreatedAt() {
		t.Error("fully populated hint should report all has* as true")
	}
}
