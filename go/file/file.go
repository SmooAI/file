// Package file provides a unified file handling library for working with
// files from local filesystem, S3, URLs, and streams.
package file

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3ClientFactory is a function that creates an S3 client. It can be replaced
// in tests to inject a mock client.
var S3ClientFactory = defaultS3ClientFactory

// S3API defines the subset of S3 client methods used by this package.
// This enables mocking in tests.
type S3API interface {
	GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

// S3PresignAPI defines the subset of S3 presign client methods used by this package.
type S3PresignAPI interface {
	PresignGetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error)
}

// HTTPClient is an interface for performing HTTP requests. It can be replaced
// in tests with an httptest server-backed client.
var HTTPClient httpDoer = http.DefaultClient

type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

func defaultS3ClientFactory() (S3API, S3PresignAPI) {
	cfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		panic(fmt.Sprintf("file: unable to load AWS config: %v", err))
	}
	client := s3.NewFromConfig(cfg)
	presignClient := s3.NewPresignClient(client)
	return client, presignClient
}

// File represents a file loaded from any source (URL, bytes, filesystem, stream, S3)
// with unified metadata and operations.
type File struct {
	source   FileSource
	meta     Metadata
	data     []byte // buffered content; may be nil until Read() is called
	loaded   bool   // whether data has been fully buffered
	s3Bucket string // set when source is S3
	s3Key    string // set when source is S3
}

// --- Constructors ---

// NewFromURL fetches a file from the given URL and returns a File.
func NewFromURL(rawURL string, hints ...MetadataHint) (*File, error) {
	var hint MetadataHint
	if len(hints) > 0 {
		hint = hints[0]
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, newError(ErrHTTP, "NewFromURL", err)
	}
	resp, err := HTTPClient.Do(req)
	if err != nil {
		return nil, newError(ErrHTTP, "NewFromURL", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, newError(ErrHTTP, "NewFromURL", fmt.Errorf("status %d", resp.StatusCode))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, newError(ErrRead, "NewFromURL", err)
	}

	meta := resolveMetadataFromHTTPResponse(resp, rawURL, data, hint)

	return &File{
		source: SourceURL,
		meta:   meta,
		data:   data,
		loaded: true,
	}, nil
}

// NewFromBytes creates a File from raw bytes.
func NewFromBytes(data []byte, hints ...MetadataHint) (*File, error) {
	var hint MetadataHint
	if len(hints) > 0 {
		hint = hints[0]
	}

	meta := resolveMetadataFromBytes(data, hint)

	return &File{
		source: SourceBytes,
		meta:   meta,
		data:   data,
		loaded: true,
	}, nil
}

// NewFromFile creates a File from a local filesystem path. The file content
// is read eagerly into memory.
func NewFromFile(filePath string, hints ...MetadataHint) (*File, error) {
	var hint MetadataHint
	if len(hints) > 0 {
		hint = hints[0]
	}

	info, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, newError(ErrNotFound, "NewFromFile", err)
		}
		return nil, newError(ErrRead, "NewFromFile", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, newError(ErrRead, "NewFromFile", err)
	}

	meta := resolveMetadataFromFile(filePath, info, data, hint)

	return &File{
		source: SourceFile,
		meta:   meta,
		data:   data,
		loaded: true,
	}, nil
}

// NewFromStream creates a File from an io.Reader. The stream content is read
// eagerly into memory.
func NewFromStream(r io.Reader, hints ...MetadataHint) (*File, error) {
	var hint MetadataHint
	if len(hints) > 0 {
		hint = hints[0]
	}

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, newError(ErrRead, "NewFromStream", err)
	}

	meta := resolveMetadataFromBytes(data, hint)

	return &File{
		source: SourceStream,
		meta:   meta,
		data:   data,
		loaded: true,
	}, nil
}

// NewFromS3 downloads a file from S3 and returns a File.
func NewFromS3(bucket, key string, hints ...MetadataHint) (*File, error) {
	return NewFromS3WithContext(context.Background(), bucket, key, hints...)
}

// NewFromS3WithContext downloads a file from S3 using the given context.
func NewFromS3WithContext(ctx context.Context, bucket, key string, hints ...MetadataHint) (*File, error) {
	var hint MetadataHint
	if len(hints) > 0 {
		hint = hints[0]
	}

	s3Client, _ := S3ClientFactory()

	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, newError(ErrS3, "NewFromS3", err)
	}
	defer out.Body.Close()

	data, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, newError(ErrRead, "NewFromS3", err)
	}

	meta := resolveMetadataFromS3(bucket, key, out, data, hint)

	return &File{
		source:   SourceS3,
		meta:     meta,
		data:     data,
		loaded:   true,
		s3Bucket: bucket,
		s3Key:    key,
	}, nil
}

// --- Accessors ---

// Source returns the FileSource indicating where the file was loaded from.
func (f *File) Source() FileSource { return f.source }

// Metadata returns a copy of the file's metadata.
func (f *File) Metadata() Metadata { return f.meta }

// Name returns the filename (may be empty).
func (f *File) Name() string { return f.meta.Name }

// MimeType returns the MIME type (may be empty).
func (f *File) MimeType() string { return f.meta.MimeType }

// Size returns the file size in bytes.
func (f *File) Size() int64 { return f.meta.Size }

// Extension returns the file extension without a leading dot (may be empty).
func (f *File) Extension() string { return f.meta.Extension }

// URL returns the source URL (may be empty).
func (f *File) URL() string { return f.meta.URL }

// Path returns the local filesystem path (may be empty).
func (f *File) Path() string { return f.meta.Path }

// Hash returns the content hash (may be empty).
func (f *File) Hash() string { return f.meta.Hash }

// LastModified returns the last modification time (may be zero).
func (f *File) LastModified() time.Time { return f.meta.LastModified }

// CreatedAt returns the creation time (may be zero).
func (f *File) CreatedAt() time.Time { return f.meta.CreatedAt }

// SetMetadata merges the given hint fields into the current metadata.
// Non-zero hint fields overwrite the current values.
func (f *File) SetMetadata(hint MetadataHint) {
	if hint.hasName() {
		f.meta.Name = hint.Name
	}
	if hint.hasMimeType() {
		f.meta.MimeType = hint.MimeType
	}
	if hint.hasSize() {
		f.meta.Size = hint.Size
	}
	if hint.hasExtension() {
		f.meta.Extension = hint.Extension
	}
	if hint.hasURL() {
		f.meta.URL = hint.URL
	}
	if hint.hasPath() {
		f.meta.Path = hint.Path
	}
	if hint.hasHash() {
		f.meta.Hash = hint.Hash
	}
	if hint.hasLastModified() {
		f.meta.LastModified = hint.LastModified
	}
	if hint.hasCreatedAt() {
		f.meta.CreatedAt = hint.CreatedAt
	}
}

// --- Read Operations ---

// Read returns the file contents as a byte slice. The data is cached after the
// first call.
func (f *File) Read() ([]byte, error) {
	if f.loaded && f.data != nil {
		return f.data, nil
	}
	return nil, newError(ErrRead, "Read", fmt.Errorf("no data available"))
}

// ReadText returns the file contents as a UTF-8 string.
func (f *File) ReadText() (string, error) {
	data, err := f.Read()
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// --- Write Operations ---

// Save writes the file to the given filesystem path. Returns a new File
// representing the saved file.
func (f *File) Save(destPath string) (*File, error) {
	data, err := f.Read()
	if err != nil {
		return nil, err
	}

	dir := filepath.Dir(destPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, newError(ErrWrite, "Save", err)
	}

	if err := os.WriteFile(destPath, data, 0o644); err != nil {
		return nil, newError(ErrWrite, "Save", err)
	}

	return NewFromFile(destPath)
}

// Move writes the file to a new location and deletes the original if it was
// a filesystem file. Returns a new File for the destination.
func (f *File) Move(destPath string) (*File, error) {
	newFile, err := f.Save(destPath)
	if err != nil {
		return nil, err
	}

	// If the source was a local file, remove the original.
	if f.source == SourceFile && f.meta.Path != "" {
		_ = os.Remove(f.meta.Path)
	}

	return newFile, nil
}

// Delete removes the file from the filesystem. Only works for file-sourced files.
func (f *File) Delete() error {
	if f.source != SourceFile || f.meta.Path == "" {
		return newError(ErrInvalidSource, "Delete", fmt.Errorf("cannot delete non-file source %s", f.source))
	}
	if err := os.Remove(f.meta.Path); err != nil {
		if os.IsNotExist(err) {
			return newError(ErrNotFound, "Delete", err)
		}
		return newError(ErrWrite, "Delete", err)
	}
	return nil
}

// --- Checksum ---

// Checksum calculates and returns the SHA-256 hex digest of the file contents.
func (f *File) Checksum() (string, error) {
	data, err := f.Read()
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:]), nil
}

// --- S3 Operations ---

// UploadToS3 uploads the file to the given S3 bucket and key.
func (f *File) UploadToS3(bucket, key string) error {
	return f.UploadToS3WithContext(context.Background(), bucket, key)
}

// UploadToS3WithContext uploads the file to S3 using the given context.
func (f *File) UploadToS3WithContext(ctx context.Context, bucket, key string) error {
	data, err := f.Read()
	if err != nil {
		return err
	}

	s3Client, _ := S3ClientFactory()

	input := &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: nilIfEmpty(f.meta.MimeType),
	}
	if f.meta.Size > 0 {
		input.ContentLength = aws.Int64(f.meta.Size)
	}
	if f.meta.Name != "" {
		input.ContentDisposition = aws.String(fmt.Sprintf(`attachment; filename="%s"`, f.meta.Name))
	}

	_, err = s3Client.PutObject(ctx, input)
	if err != nil {
		return newError(ErrS3, "UploadToS3", err)
	}
	return nil
}

// DownloadFromS3 downloads a file from S3 and replaces this File's content
// and metadata. This is a convenience for refreshing an S3-sourced file.
func (f *File) DownloadFromS3(bucket, key string) error {
	return f.DownloadFromS3WithContext(context.Background(), bucket, key)
}

// DownloadFromS3WithContext downloads from S3 using the given context.
func (f *File) DownloadFromS3WithContext(ctx context.Context, bucket, key string) error {
	newFile, err := NewFromS3WithContext(ctx, bucket, key)
	if err != nil {
		return err
	}
	*f = *newFile
	return nil
}

// GetSignedURL generates a presigned GET URL for the file's S3 object.
// expiresIn specifies how long the URL remains valid.
// The file must have been loaded from S3 (or have s3Bucket/s3Key set).
func (f *File) GetSignedURL(expiresIn time.Duration) (string, error) {
	return f.GetSignedURLWithContext(context.Background(), expiresIn)
}

// GetSignedURLWithContext generates a presigned URL using the given context.
func (f *File) GetSignedURLWithContext(ctx context.Context, expiresIn time.Duration) (string, error) {
	bucket, key := f.s3Bucket, f.s3Key

	// If not set directly, try to parse from the s3:// URL.
	if bucket == "" || key == "" {
		var ok bool
		bucket, key, ok = parseS3URI(f.meta.URL)
		if !ok {
			return "", newError(ErrInvalidSource, "GetSignedURL", fmt.Errorf("file is not S3-sourced"))
		}
	}

	_, presignClient := S3ClientFactory()

	req, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, func(o *s3.PresignOptions) {
		o.Expires = expiresIn
	})
	if err != nil {
		return "", newError(ErrS3, "GetSignedURL", err)
	}
	return req.URL, nil
}

// --- Append / Prepend / Truncate ---

// Append adds content to the end of the file. Only works for file-sourced files
// (writes directly to the filesystem path).
func (f *File) Append(content []byte) error {
	if f.source != SourceFile || f.meta.Path == "" {
		return newError(ErrInvalidSource, "Append", fmt.Errorf("cannot append to non-file source %s", f.source))
	}

	fl, err := os.OpenFile(f.meta.Path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return newError(ErrWrite, "Append", err)
	}
	defer fl.Close()

	if _, err := fl.Write(content); err != nil {
		return newError(ErrWrite, "Append", err)
	}

	return f.refresh()
}

// Prepend inserts content at the beginning of the file. Only works for file-sourced files.
func (f *File) Prepend(content []byte) error {
	if f.source != SourceFile || f.meta.Path == "" {
		return newError(ErrInvalidSource, "Prepend", fmt.Errorf("cannot prepend to non-file source %s", f.source))
	}

	existing, err := os.ReadFile(f.meta.Path)
	if err != nil {
		return newError(ErrRead, "Prepend", err)
	}

	combined := make([]byte, 0, len(content)+len(existing))
	combined = append(combined, content...)
	combined = append(combined, existing...)

	if err := os.WriteFile(f.meta.Path, combined, 0o644); err != nil {
		return newError(ErrWrite, "Prepend", err)
	}

	return f.refresh()
}

// Truncate truncates the file to the given size in bytes. Only works for file-sourced files.
func (f *File) Truncate(size int64) error {
	if f.source != SourceFile || f.meta.Path == "" {
		return newError(ErrInvalidSource, "Truncate", fmt.Errorf("cannot truncate non-file source %s", f.source))
	}

	if err := os.Truncate(f.meta.Path, size); err != nil {
		return newError(ErrWrite, "Truncate", err)
	}

	return f.refresh()
}

// --- String ---

// String returns a human-readable representation of the file.
func (f *File) String() string {
	return fmt.Sprintf("File{source=%s, name=%q, mime=%q, size=%d, ext=%q}",
		f.source, f.meta.Name, f.meta.MimeType, f.meta.Size, f.meta.Extension)
}

// --- Internal helpers ---

// refresh re-reads the file from disk after a modification.
func (f *File) refresh() error {
	if f.source != SourceFile || f.meta.Path == "" {
		return nil
	}
	newFile, err := NewFromFile(f.meta.Path)
	if err != nil {
		return err
	}
	*f = *newFile
	return nil
}

// resolveMetadataFromHTTPResponse builds Metadata from an HTTP response, URL,
// downloaded data, and optional hints. Follows the same priority chain as the
// TypeScript implementation.
func resolveMetadataFromHTTPResponse(resp *http.Response, rawURL string, data []byte, hint MetadataHint) Metadata {
	m := Metadata{}

	// Start with hints as baseline.
	applyHint(&m, hint)

	// Parse response headers (may override hints).
	if resp != nil {
		cd := resp.Header.Get("Content-Disposition")
		if cdName := ParseContentDisposition(cd); cdName != "" {
			m.Name = cdName
		} else if urlName := filenameFromURL(rawURL); urlName != "" && m.Name == "" {
			m.Name = urlName
		}

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			m.MimeType = ct
		}
		if cl := resp.Header.Get("Content-Length"); cl != "" {
			if n, err := strconv.ParseInt(cl, 10, 64); err == nil {
				m.Size = n
			}
		}
		if etag := resp.Header.Get("ETag"); etag != "" {
			m.Hash = strings.Trim(etag, `"`)
		} else if md5 := resp.Header.Get("Content-MD5"); md5 != "" {
			m.Hash = md5
		}
		if lm := resp.Header.Get("Last-Modified"); lm != "" {
			if t, err := http.ParseTime(lm); err == nil {
				m.LastModified = t
			}
		}
	}

	// Override size from hint if hint provided it and response did not.
	if m.Size == 0 && hint.hasSize() {
		m.Size = hint.Size
	}

	// Set URL.
	if rawURL != "" {
		m.URL = rawURL
	}

	// Detect from name if MIME not set.
	if m.MimeType == "" && m.Name != "" {
		m.MimeType = MimeTypeFromFilename(m.Name)
	}

	// Magic-byte detection from data.
	if detected := DetectMimeTypeFromBytes(data); detected != "" {
		m.MimeType = detected
	}
	if detected := DetectExtensionFromBytes(data); detected != "" {
		m.Extension = detected
	}

	// Fallback: derive extension from MIME type.
	if m.Extension == "" && m.MimeType != "" {
		m.Extension = ExtensionFromMimeType(m.MimeType)
	}

	// Fallback: derive extension from name.
	if m.Extension == "" && m.Name != "" {
		m.Extension = ExtensionFromFilename(m.Name)
	}

	return m
}

// resolveMetadataFromBytes builds Metadata from raw bytes and optional hints.
func resolveMetadataFromBytes(data []byte, hint MetadataHint) Metadata {
	m := Metadata{}
	applyHint(&m, hint)

	if m.Size == 0 {
		m.Size = int64(len(data))
	}

	// Detect from name.
	if m.MimeType == "" && m.Name != "" {
		m.MimeType = MimeTypeFromFilename(m.Name)
	}

	// Magic-byte detection.
	if detected := DetectMimeTypeFromBytes(data); detected != "" {
		m.MimeType = detected
	}
	if detected := DetectExtensionFromBytes(data); detected != "" {
		m.Extension = detected
	}

	// Fallback extension from MIME type.
	if m.Extension == "" && m.MimeType != "" {
		m.Extension = ExtensionFromMimeType(m.MimeType)
	}

	// Fallback extension from name.
	if m.Extension == "" && m.Name != "" {
		m.Extension = ExtensionFromFilename(m.Name)
	}

	return m
}

// resolveMetadataFromFile builds Metadata from a filesystem path and stat info.
func resolveMetadataFromFile(filePath string, info os.FileInfo, data []byte, hint MetadataHint) Metadata {
	m := Metadata{}
	applyHint(&m, hint)

	// Set path and name from the filesystem.
	m.Path = filePath
	if m.Name == "" {
		m.Name = filepath.Base(filePath)
	}

	// Stat info.
	m.Size = info.Size()
	m.LastModified = info.ModTime()

	// Magic-byte detection from file path.
	if detected := DetectMimeTypeFromFilePath(filePath); detected != "" {
		m.MimeType = detected
	}
	if detected := DetectExtensionFromFilePath(filePath); detected != "" {
		m.Extension = detected
	}

	// Fallback: magic-byte from data.
	if m.MimeType == "" {
		if detected := DetectMimeTypeFromBytes(data); detected != "" {
			m.MimeType = detected
		}
	}

	// Fallback: from name.
	if m.MimeType == "" && m.Name != "" {
		m.MimeType = MimeTypeFromFilename(m.Name)
	}

	// Fallback extension.
	if m.Extension == "" && m.MimeType != "" {
		m.Extension = ExtensionFromMimeType(m.MimeType)
	}
	if m.Extension == "" && m.Name != "" {
		m.Extension = ExtensionFromFilename(m.Name)
	}

	return m
}

// resolveMetadataFromS3 builds Metadata from an S3 GetObject response.
func resolveMetadataFromS3(bucket, key string, out *s3.GetObjectOutput, data []byte, hint MetadataHint) Metadata {
	m := Metadata{}
	applyHint(&m, hint)

	// S3 URI.
	m.URL = fmt.Sprintf("s3://%s/%s", bucket, key)
	if m.Name == "" {
		m.Name = path.Base(key)
	}

	// S3 response metadata.
	if out != nil {
		if out.ContentDisposition != nil {
			if cdName := ParseContentDisposition(*out.ContentDisposition); cdName != "" {
				m.Name = cdName
			}
		}
		if out.ContentType != nil && *out.ContentType != "" {
			m.MimeType = *out.ContentType
		}
		if out.ContentLength != nil {
			m.Size = *out.ContentLength
		}
		if out.ETag != nil && *out.ETag != "" {
			m.Hash = strings.Trim(*out.ETag, `"`)
		}
		if out.LastModified != nil {
			m.LastModified = *out.LastModified
		}
	}

	if m.Size == 0 {
		m.Size = int64(len(data))
	}

	// Detect from name.
	if m.MimeType == "" && m.Name != "" {
		m.MimeType = MimeTypeFromFilename(m.Name)
	}

	// Magic-byte detection.
	if detected := DetectMimeTypeFromBytes(data); detected != "" {
		m.MimeType = detected
	}
	if detected := DetectExtensionFromBytes(data); detected != "" {
		m.Extension = detected
	}

	// Fallback extension from MIME type.
	if m.Extension == "" && m.MimeType != "" {
		m.Extension = ExtensionFromMimeType(m.MimeType)
	}

	// Fallback extension from name.
	if m.Extension == "" && m.Name != "" {
		m.Extension = ExtensionFromFilename(m.Name)
	}

	return m
}

// applyHint copies non-zero hint fields into the Metadata.
func applyHint(m *Metadata, hint MetadataHint) {
	if hint.hasName() {
		m.Name = hint.Name
	}
	if hint.hasMimeType() {
		m.MimeType = hint.MimeType
	}
	if hint.hasSize() {
		m.Size = hint.Size
	}
	if hint.hasExtension() {
		m.Extension = hint.Extension
	}
	if hint.hasURL() {
		m.URL = hint.URL
	}
	if hint.hasPath() {
		m.Path = hint.Path
	}
	if hint.hasHash() {
		m.Hash = hint.Hash
	}
	if hint.hasLastModified() {
		m.LastModified = hint.LastModified
	}
	if hint.hasCreatedAt() {
		m.CreatedAt = hint.CreatedAt
	}
}

// filenameFromURL extracts the filename from a URL path, returning empty if
// it cannot be determined.
func filenameFromURL(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	base := path.Base(u.Path)
	if base == "" || base == "/" || base == "." {
		return ""
	}
	return base
}

// parseS3URI extracts bucket and key from an s3://bucket/key URI.
func parseS3URI(uri string) (bucket, key string, ok bool) {
	if !strings.HasPrefix(uri, "s3://") {
		return "", "", false
	}
	rest := strings.TrimPrefix(uri, "s3://")
	idx := strings.Index(rest, "/")
	if idx < 0 {
		return rest, "", false
	}
	return rest[:idx], rest[idx+1:], true
}

// nilIfEmpty returns a pointer to s if non-empty, or nil.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
