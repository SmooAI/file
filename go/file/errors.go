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
