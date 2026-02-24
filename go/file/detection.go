package file

import (
	"mime"
	"path/filepath"
	"strings"

	"github.com/gabriel-vasile/mimetype"
)

// DetectMimeTypeFromBytes uses magic-byte detection to determine the MIME type
// of the given data. Returns an empty string if detection fails.
func DetectMimeTypeFromBytes(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	mtype := mimetype.Detect(data)
	if mtype == nil {
		return ""
	}
	result := mtype.String()
	// mimetype sometimes returns "application/octet-stream" when it cannot detect,
	// which is not very useful, so treat it as unknown.
	if result == "application/octet-stream" {
		return ""
	}
	return result
}

// DetectExtensionFromBytes uses magic-byte detection to determine the file extension
// of the given data. Returns an empty string if detection fails.
// The returned extension has no leading dot (e.g., "png", not ".png").
func DetectExtensionFromBytes(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	mtype := mimetype.Detect(data)
	if mtype == nil {
		return ""
	}
	ext := mtype.Extension()
	// mimetype returns ".ext" format; strip the leading dot.
	ext = strings.TrimPrefix(ext, ".")
	if ext == "" || ext == "bin" {
		return ""
	}
	return ext
}

// DetectMimeTypeFromFilePath uses magic-byte detection to determine the MIME type
// of the file at the given path. Returns an empty string if detection fails.
func DetectMimeTypeFromFilePath(filePath string) string {
	mtype, err := mimetype.DetectFile(filePath)
	if err != nil || mtype == nil {
		return ""
	}
	result := mtype.String()
	if result == "application/octet-stream" {
		return ""
	}
	return result
}

// DetectExtensionFromFilePath uses magic-byte detection to determine the file extension
// of the file at the given path. Returns an empty string if detection fails.
func DetectExtensionFromFilePath(filePath string) string {
	mtype, err := mimetype.DetectFile(filePath)
	if err != nil || mtype == nil {
		return ""
	}
	ext := mtype.Extension()
	ext = strings.TrimPrefix(ext, ".")
	if ext == "" || ext == "bin" {
		return ""
	}
	return ext
}

// MimeTypeFromExtension looks up the MIME type for a given file extension.
// The extension should not have a leading dot (e.g., "txt", not ".txt").
// Returns an empty string if no match is found.
func MimeTypeFromExtension(ext string) string {
	if ext == "" {
		return ""
	}
	if ext[0] != '.' {
		ext = "." + ext
	}
	return mime.TypeByExtension(ext)
}

// ExtensionFromMimeType looks up the preferred file extension for a given MIME type.
// Returns the extension without a leading dot (e.g., "txt").
// Returns an empty string if no match is found.
func ExtensionFromMimeType(mimeType string) string {
	if mimeType == "" {
		return ""
	}
	// Strip parameters like "; charset=utf-8".
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	exts, err := mime.ExtensionsByType(mimeType)
	if err != nil || len(exts) == 0 {
		return ""
	}
	// Return the first extension without the leading dot.
	return strings.TrimPrefix(exts[0], ".")
}

// MimeTypeFromFilename looks up the MIME type from a filename's extension.
// Returns an empty string if no match is found.
func MimeTypeFromFilename(name string) string {
	ext := filepath.Ext(name)
	if ext == "" {
		return ""
	}
	return mime.TypeByExtension(ext)
}

// ExtensionFromFilename extracts the extension from a filename.
// Returns the extension without a leading dot (e.g., "txt").
func ExtensionFromFilename(name string) string {
	ext := filepath.Ext(name)
	return strings.TrimPrefix(ext, ".")
}
