package file

// FileSource represents the origin of a file.
type FileSource string

const (
	// SourceURL indicates the file was loaded from a URL.
	SourceURL FileSource = "Url"
	// SourceBytes indicates the file was created from raw bytes.
	SourceBytes FileSource = "Bytes"
	// SourceFile indicates the file was loaded from the local filesystem.
	SourceFile FileSource = "File"
	// SourceStream indicates the file was created from an io.Reader stream.
	SourceStream FileSource = "Stream"
	// SourceS3 indicates the file was loaded from Amazon S3.
	SourceS3 FileSource = "S3"
)

// String returns the string representation of a FileSource.
func (s FileSource) String() string {
	return string(s)
}

// Valid returns true if the FileSource is one of the known sources.
func (s FileSource) Valid() bool {
	switch s {
	case SourceURL, SourceBytes, SourceFile, SourceStream, SourceS3:
		return true
	default:
		return false
	}
}
