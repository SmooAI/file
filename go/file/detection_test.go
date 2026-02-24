package file

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectMimeTypeFromBytes(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		wantMime string
	}{
		{
			name:     "empty data returns empty",
			data:     nil,
			wantMime: "",
		},
		{
			name:     "zero-length slice returns empty",
			data:     []byte{},
			wantMime: "",
		},
		{
			name: "PNG magic bytes",
			// PNG header: 89 50 4E 47 0D 0A 1A 0A
			data:     []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			wantMime: "image/png",
		},
		{
			name: "JPEG magic bytes",
			// JPEG: FF D8 FF
			data:     []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00},
			wantMime: "image/jpeg",
		},
		{
			name: "PDF magic bytes",
			data: []byte("%PDF-1.4 some content here enough bytes"),
			// mimetype library returns "application/pdf" for PDF headers
			wantMime: "application/pdf",
		},
		{
			name:     "plain text detected as text/plain",
			data:     []byte("Hello, world!"),
			wantMime: "text/plain; charset=utf-8",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetectMimeTypeFromBytes(tt.data)
			if got != tt.wantMime {
				t.Errorf("DetectMimeTypeFromBytes() = %q, want %q", got, tt.wantMime)
			}
		})
	}
}

func TestDetectExtensionFromBytes(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		wantExt string
	}{
		{
			name:    "empty data returns empty",
			data:    nil,
			wantExt: "",
		},
		{
			name:    "PNG magic bytes",
			data:    []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			wantExt: "png",
		},
		{
			name:    "PDF magic bytes",
			data:    []byte("%PDF-1.4 some content here enough bytes"),
			wantExt: "pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetectExtensionFromBytes(tt.data)
			if got != tt.wantExt {
				t.Errorf("DetectExtensionFromBytes() = %q, want %q", got, tt.wantExt)
			}
		})
	}
}

func TestDetectMimeTypeFromFilePath(t *testing.T) {
	// Create a temp file with PNG header.
	dir := t.TempDir()
	pngPath := filepath.Join(dir, "test.png")
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52}
	if err := os.WriteFile(pngPath, pngHeader, 0o644); err != nil {
		t.Fatal(err)
	}

	got := DetectMimeTypeFromFilePath(pngPath)
	if got != "image/png" {
		t.Errorf("DetectMimeTypeFromFilePath() = %q, want %q", got, "image/png")
	}

	// Non-existent file.
	got = DetectMimeTypeFromFilePath("/nonexistent/file")
	if got != "" {
		t.Errorf("DetectMimeTypeFromFilePath(nonexistent) = %q, want empty", got)
	}
}

func TestDetectExtensionFromFilePath(t *testing.T) {
	dir := t.TempDir()
	pngPath := filepath.Join(dir, "test.png")
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52}
	if err := os.WriteFile(pngPath, pngHeader, 0o644); err != nil {
		t.Fatal(err)
	}

	got := DetectExtensionFromFilePath(pngPath)
	if got != "png" {
		t.Errorf("DetectExtensionFromFilePath() = %q, want %q", got, "png")
	}
}

func TestMimeTypeFromExtension(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{"", ""},
		{"txt", "text/plain; charset=utf-8"},
		{"html", "text/html; charset=utf-8"},
		{"png", "image/png"},
		{"jpg", "image/jpeg"},
		{"pdf", "application/pdf"},
		{"zzzzunknown", ""},
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			got := MimeTypeFromExtension(tt.ext)
			if got != tt.want {
				t.Errorf("MimeTypeFromExtension(%q) = %q, want %q", tt.ext, got, tt.want)
			}
		})
	}
}

func TestExtensionFromMimeType(t *testing.T) {
	tests := []struct {
		mime string
		want string
	}{
		{"", ""},
		{"image/png", "png"},
		{"application/pdf", "pdf"},
		{"totally/unknown-mime", ""},
	}

	for _, tt := range tests {
		t.Run(tt.mime, func(t *testing.T) {
			got := ExtensionFromMimeType(tt.mime)
			if got != tt.want {
				t.Errorf("ExtensionFromMimeType(%q) = %q, want %q", tt.mime, got, tt.want)
			}
		})
	}
}

func TestMimeTypeFromFilename(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{"example.txt", "text/plain; charset=utf-8"},
		{"photo.png", "image/png"},
		{"noext", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MimeTypeFromFilename(tt.name)
			if got != tt.want {
				t.Errorf("MimeTypeFromFilename(%q) = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

func TestExtensionFromFilename(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{"example.txt", "txt"},
		{"photo.png", "png"},
		{"archive.tar.gz", "gz"},
		{"noext", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtensionFromFilename(tt.name)
			if got != tt.want {
				t.Errorf("ExtensionFromFilename(%q) = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

func TestExtensionFromMimeType_StripParams(t *testing.T) {
	// Ensure MIME type parameters are stripped.
	got := ExtensionFromMimeType("text/plain; charset=utf-8")
	if got == "" {
		t.Error("ExtensionFromMimeType with params should return a non-empty extension")
	}
}
