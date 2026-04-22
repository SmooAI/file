package file

import (
	"errors"
	"fmt"
)

// Sentinel errors for the file package.
var (
	// ErrInvalidSource is returned when a file operation is not supported for the file's source type.
	ErrInvalidSource = errors.New("file: invalid or unsupported source for this operation")

	// ErrNotFound is returned when a file does not exist on the filesystem.
	ErrNotFound = errors.New("file: file not found")

	// ErrS3 is returned when an S3 operation fails.
	ErrS3 = errors.New("file: S3 operation failed")

	// ErrHTTP is returned when fetching a file from a URL fails.
	ErrHTTP = errors.New("file: HTTP request failed")

	// ErrRead is returned when reading file content fails.
	ErrRead = errors.New("file: read operation failed")

	// ErrWrite is returned when writing file content fails.
	ErrWrite = errors.New("file: write operation failed")
)

// FileError wraps an underlying error with a sentinel from this package.
type FileError struct {
	// Sentinel is the high-level category error (e.g., ErrS3, ErrNotFound).
	Sentinel error
	// Op is the operation that failed (e.g., "NewFromURL", "UploadToS3").
	Op string
	// Err is the underlying error.
	Err error
}

// Error returns the formatted error string.
func (e *FileError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Sentinel, e.Op, e.Err)
	}
	return fmt.Sprintf("%s: %s", e.Sentinel, e.Op)
}

// Unwrap returns the underlying error so errors.Is and errors.As work correctly.
func (e *FileError) Unwrap() error {
	return e.Err
}

// Is reports whether target matches the sentinel.
func (e *FileError) Is(target error) bool {
	return errors.Is(e.Sentinel, target)
}

// newError creates a new FileError.
func newError(sentinel error, op string, err error) *FileError {
	return &FileError{
		Sentinel: sentinel,
		Op:       op,
		Err:      err,
	}
}

// ValidationKind enumerates the possible validation failure categories.
// Callers can branch on this field after an errors.As against *FileValidationError.
type ValidationKind string

const (
	// KindSize indicates the file exceeded the declared maxSize.
	KindSize ValidationKind = "size"
	// KindMime indicates the file's mime type was not in the declared allowlist.
	KindMime ValidationKind = "mime"
	// KindContentMismatch indicates the magic-byte-detected mime type disagreed
	// with the caller's expected/claimed mime type.
	KindContentMismatch ValidationKind = "content_mismatch"
)

// ErrFileValidation is the sentinel for all file validation failures. Use
// errors.Is(err, ErrFileValidation) to catch any validation error, or errors.As
// with *FileValidationError to inspect structured fields.
var ErrFileValidation = errors.New("file: validation failed")

// FileValidationError is the single validation error type, with a Kind field
// that distinguishes size/mime/content-mismatch failures. This mirrors the
// TypeScript FileSizeError / FileMimeError / FileContentMismatchError hierarchy
// without requiring inheritance — callers use errors.As and then branch on Kind.
//
//	var vErr *FileValidationError
//	if errors.As(err, &vErr) {
//	    switch vErr.Kind {
//	    case KindSize: ...
//	    case KindMime: ...
//	    case KindContentMismatch: ...
//	    }
//	}
type FileValidationError struct {
	// Kind is the category of validation failure.
	Kind ValidationKind

	// Size fields — populated when Kind == KindSize.
	// ActualSize is -1 if the size is unknown.
	ActualSize int64
	MaxSize    int64

	// Mime fields — populated when Kind == KindMime.
	ActualMimeType string
	AllowedMimes   []string

	// Content-mismatch fields — populated when Kind == KindContentMismatch.
	ClaimedMimeType  string
	DetectedMimeType string
}

// Error returns a human-readable description of the validation failure.
func (e *FileValidationError) Error() string {
	switch e.Kind {
	case KindSize:
		if e.ActualSize < 0 {
			return fmt.Sprintf("file: size is unknown; maxSize is %d bytes", e.MaxSize)
		}
		return fmt.Sprintf("file: size (%d bytes) exceeds maximum allowed (%d bytes)", e.ActualSize, e.MaxSize)
	case KindMime:
		if e.ActualMimeType == "" {
			return fmt.Sprintf("file: mime type is unknown; allowed types are: %v", e.AllowedMimes)
		}
		return fmt.Sprintf("file: mime type %q is not in the allowed list: %v", e.ActualMimeType, e.AllowedMimes)
	case KindContentMismatch:
		claimed := e.ClaimedMimeType
		if claimed == "" {
			claimed = "unknown"
		}
		detected := e.DetectedMimeType
		if detected == "" {
			detected = "unknown"
		}
		return fmt.Sprintf("file: content does not match claimed mime type; claimed=%s detected=%s", claimed, detected)
	default:
		return fmt.Sprintf("file: validation failed (kind=%s)", e.Kind)
	}
}

// Is reports whether target matches ErrFileValidation, enabling
// errors.Is(err, ErrFileValidation) to catch any validation failure.
func (e *FileValidationError) Is(target error) bool {
	return target == ErrFileValidation
}
