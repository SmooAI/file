package file

import "time"

// Metadata holds information about a file's properties and attributes.
type Metadata struct {
	// Name is the filename (e.g., "example.txt").
	Name string
	// MimeType is the MIME content type (e.g., "text/plain").
	MimeType string
	// Size is the file size in bytes.
	Size int64
	// Extension is the file extension without a leading dot (e.g., "txt").
	Extension string
	// URL is the source URL for URL-sourced files or the S3 URI for S3-sourced files.
	URL string
	// Path is the local filesystem path for file-sourced files.
	Path string
	// Hash is an ETag, MD5, or other content hash from the source.
	Hash string
	// LastModified is the last modification time.
	LastModified time.Time
	// CreatedAt is the creation time (birthtime).
	CreatedAt time.Time
}

// MetadataHint provides optional hints for metadata resolution.
// Zero-value fields are ignored during the metadata pipeline.
type MetadataHint struct {
	Name         string
	MimeType     string
	Size         int64
	Extension    string
	URL          string
	Path         string
	Hash         string
	LastModified time.Time
	CreatedAt    time.Time
}

// hasName returns true if the hint has a non-empty Name.
func (h MetadataHint) hasName() bool { return h.Name != "" }

// hasMimeType returns true if the hint has a non-empty MimeType.
func (h MetadataHint) hasMimeType() bool { return h.MimeType != "" }

// hasSize returns true if the hint has a non-zero Size.
func (h MetadataHint) hasSize() bool { return h.Size > 0 }

// hasExtension returns true if the hint has a non-empty Extension.
func (h MetadataHint) hasExtension() bool { return h.Extension != "" }

// hasURL returns true if the hint has a non-empty URL.
func (h MetadataHint) hasURL() bool { return h.URL != "" }

// hasPath returns true if the hint has a non-empty Path.
func (h MetadataHint) hasPath() bool { return h.Path != "" }

// hasHash returns true if the hint has a non-empty Hash.
func (h MetadataHint) hasHash() bool { return h.Hash != "" }

// hasLastModified returns true if the hint has a non-zero LastModified.
func (h MetadataHint) hasLastModified() bool { return !h.LastModified.IsZero() }

// hasCreatedAt returns true if the hint has a non-zero CreatedAt.
func (h MetadataHint) hasCreatedAt() bool { return !h.CreatedAt.IsZero() }
