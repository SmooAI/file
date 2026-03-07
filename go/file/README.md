<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->

<a name="readme-top"></a>

<!--
*** Thanks for checking out the Best-README-Template. If you have a suggestion
*** that would make this better, please fork the repo and create a pull request
*** or simply open an issue with the tag "enhancement".
*** Don't forget to give the project a star!
*** Thanks again! Now go create something AMAZING! :D
-->

<!-- PROJECT SHIELDS -->
<!--
*** I'm using markdown "reference style" links for readability.
*** Reference links are enclosed in brackets [ ] instead of parentheses ( ).
*** See the bottom of this document for the declaration of the reference variables
*** for contributors-url, forks-url, etc. This is an optional, concise syntax you may use.
*** https://www.markdownguide.org/basic-syntax/#reference-style-links
-->

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://smoo.ai">
    <img src="../../../images/logo.png" alt="SmooAI Logo" />
  </a>
</div>

<!-- ABOUT THE PROJECT -->

## About SmooAI

SmooAI is an AI-powered platform for helping businesses multiply their customer, employee, and developer experience.

Learn more on [smoo.ai](https://smoo.ai)

## SmooAI Packages

Check out other SmooAI packages at [smoo.ai/open-source](https://smoo.ai/open-source)

## About smooai-file (Go)

A powerful file handling package for Go that provides a unified interface for working with files from local filesystem, S3, URLs, bytes, and streams. Built with memory efficiency in mind — file bytes are eagerly buffered but the interface is designed for minimal allocations and straightforward, idiomatic Go error handling.

![GitHub License](https://img.shields.io/github/license/SmooAI/file?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/SmooAI/file/release.yml?style=for-the-badge)
![GitHub Repo stars](https://img.shields.io/github/stars/SmooAI/file?style=for-the-badge)

### Go Package

A Go port of [@smooai/file](https://www.npmjs.com/package/@smooai/file) that mirrors the feature set of the TypeScript, Python, and Rust versions. The package provides a single `File` struct with constructors for every supported source, rich metadata extraction, and full AWS S3 integration via the AWS SDK for Go v2. S3 and HTTP clients are interface-backed, making the package straightforward to test with mocks.

### Install

```bash
go get github.com/SmooAI/file/go/file
```

### Multi-Language Support

smooai-file is available as native implementations in **TypeScript**, **Python**, **Rust**, and **Go** — each built with idiomatic patterns for its ecosystem.

| Language   | Package                                                      | Install                                 |
| ---------- | ------------------------------------------------------------ | --------------------------------------- |
| TypeScript | [`@smooai/file`](https://www.npmjs.com/package/@smooai/file) | `pnpm add @smooai/file`                 |
| Python     | [`smooai-file`](https://pypi.org/project/smooai-file/)       | `pip install smooai-file`               |
| Rust       | [`smooai-file`](https://crates.io/crates/smooai-file)        | `cargo add smooai-file`                 |
| Go         | `github.com/SmooAI/file/go/file`                             | `go get github.com/SmooAI/file/go/file` |

### Key Features

#### Idiomatic Go Design

- Standard `error` return values — no panics in normal operation
- Interface-backed S3 (`S3API`, `S3PresignAPI`) and HTTP (`httpDoer`) clients for easy testing
- Context-aware S3 operations (`NewFromS3WithContext`, `UploadToS3WithContext`, etc.)
- Pointer-receiver methods on `*File` for in-place mutations

#### Multiple File Sources

- **Local Filesystem** — eager read with `os.ReadFile`, stat metadata (size, modified time)
- **URLs** — automatic download via `net/http`, header metadata extraction
- **S3 Objects** — direct AWS S3 integration via the AWS SDK v2, ETag and Content-Type extraction
- **Bytes** — raw `[]byte` buffers with full metadata support
- **Streams** — any `io.Reader` consumed with `io.ReadAll`

#### Intelligent File Type Detection

Automatic MIME type and extension detection using a priority cascade:

1. Magic-byte inspection of file contents
2. HTTP response headers (`Content-Type`, `Content-Disposition`, `ETag`, `Last-Modified`)
3. S3 object metadata
4. Filename/extension fallback

#### Rich Metadata

- File name and extension
- MIME type
- File size in bytes (`int64`)
- Last modified timestamp (`time.Time`)
- SHA-256 checksum
- URL and filesystem path
- Source type (`Url`, `Bytes`, `File`, `Stream`, `S3`)

### Examples

- [Basic Usage](#basic-usage)
- [URL Download](#url-download)
- [S3 Integration](#s3-integration)
- [Stream Handling](#stream-handling)
- [File Operations](#file-operations)

#### Basic Usage <a name="basic-usage"></a>

```go
package main

import (
    "fmt"
    "log"

    "github.com/SmooAI/file/go/file"
)

func main() {
    // Create from a local path
    f, err := file.NewFromFile("/path/to/document.pdf")
    if err != nil {
        log.Fatal(err)
    }

    // Read contents
    data, err := f.Read()     // []byte
    if err != nil {
        log.Fatal(err)
    }
    text, err := f.ReadText() // string (UTF-8)
    if err != nil {
        log.Fatal(err)
    }
    _ = data
    _ = text

    // Access metadata
    fmt.Println(f.Name())         // "document.pdf"
    fmt.Println(f.MimeType())     // "application/pdf"
    fmt.Println(f.Size())         // 102400
    fmt.Println(f.Extension())    // "pdf"
    fmt.Println(f.Path())         // "/path/to/document.pdf"
    fmt.Println(f.LastModified()) // time.Time{...}
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### URL Download <a name="url-download"></a>

```go
package main

import (
    "fmt"
    "log"

    "github.com/SmooAI/file/go/file"
)

func main() {
    // Fetch from a URL (uses net/http under the hood)
    f, err := file.NewFromURL("https://example.com/report.pdf")
    if err != nil {
        log.Fatal(err)
    }

    // MIME type detected from Content-Type header and magic bytes
    fmt.Println(f.MimeType())   // "application/pdf"
    fmt.Println(f.Size())       // populated from Content-Length header

    // Save to disk -- returns a new *File for the saved copy
    saved, err := f.Save("/tmp/report.pdf")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(saved.Path())   // "/tmp/report.pdf"
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### S3 Integration <a name="s3-integration"></a>

```go
package main

import (
    "fmt"
    "log"
    "time"

    "github.com/SmooAI/file/go/file"
)

func main() {
    // Download from S3 (AWS credentials loaded from environment / IAM role)
    f, err := file.NewFromS3("my-bucket", "reports/report.pdf")
    if err != nil {
        log.Fatal(err)
    }

    // Upload to S3 (sets ContentType, ContentLength, ContentDisposition)
    if err := f.UploadToS3("my-bucket", "archive/report.pdf"); err != nil {
        log.Fatal(err)
    }

    // Generate a presigned URL (expires in 1 hour)
    signed, err := f.GetSignedURL(time.Hour)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(signed)

    // Refresh S3 content into this File (in-place update)
    if err := f.DownloadFromS3("my-bucket", "reports/report.pdf"); err != nil {
        log.Fatal(err)
    }
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### Stream Handling <a name="stream-handling"></a>

```go
package main

import (
    "fmt"
    "log"
    "strings"

    "github.com/SmooAI/file/go/file"
)

func main() {
    // Create from any io.Reader
    r := strings.NewReader("hello world")
    f, err := file.NewFromStream(r)
    if err != nil {
        log.Fatal(err)
    }

    text, _ := f.ReadText()
    fmt.Println(text)       // "hello world"
    fmt.Println(f.Size())   // 11
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### File Operations <a name="file-operations"></a>

```go
package main

import (
    "fmt"
    "log"

    "github.com/SmooAI/file/go/file"
)

func main() {
    f, err := file.NewFromFile("/tmp/notes.txt")
    if err != nil {
        log.Fatal(err)
    }

    // Append and prepend (local files only -- rewrites the file on disk)
    if err := f.Append([]byte("\nnew line")); err != nil {
        log.Fatal(err)
    }
    if err := f.Prepend([]byte("# Header\n")); err != nil {
        log.Fatal(err)
    }

    // Truncate to 1 KB
    if err := f.Truncate(1024); err != nil {
        log.Fatal(err)
    }

    // Compute SHA-256 checksum
    digest, err := f.Checksum()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(digest)   // 64-char hex string

    // Move to a new location (deletes source for filesystem files)
    moved, err := f.Move("/tmp/archive/notes.txt")
    if err != nil {
        log.Fatal(err)
    }

    // Delete from filesystem
    if err := moved.Delete(); err != nil {
        log.Fatal(err)
    }

    // Override metadata fields
    f2, _ := file.NewFromBytes([]byte("data"))
    f2.SetMetadata(file.MetadataHint{Name: "data.bin", MimeType: "application/octet-stream"})
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

## API Reference

### Constructors

```go
file.NewFromURL(rawURL string, hints ...MetadataHint) (*File, error)
file.NewFromBytes(data []byte, hints ...MetadataHint) (*File, error)
file.NewFromFile(filePath string, hints ...MetadataHint) (*File, error)
file.NewFromStream(r io.Reader, hints ...MetadataHint) (*File, error)
file.NewFromS3(bucket, key string, hints ...MetadataHint) (*File, error)
file.NewFromS3WithContext(ctx context.Context, bucket, key string, hints ...MetadataHint) (*File, error)
```

### Accessors

```go
f.Source()       FileSource
f.Metadata()     Metadata
f.Name()         string
f.MimeType()     string
f.Size()         int64
f.Extension()    string
f.URL()          string
f.Path()         string
f.Hash()         string
f.LastModified() time.Time
f.CreatedAt()    time.Time
f.SetMetadata(hint MetadataHint)
```

### Read Operations

```go
f.Read()     ([]byte, error)   // raw bytes
f.ReadText() (string, error)   // UTF-8 string
```

### Write Operations

```go
f.Save(destPath string)  (*File, error)    // writes to path, returns new *File
f.Move(destPath string)  (*File, error)    // saves + deletes source if filesystem
f.Delete()               error             // filesystem files only
```

### Modify Operations (filesystem files only)

```go
f.Append(content []byte)   error
f.Prepend(content []byte)  error
f.Truncate(size int64)     error
```

### S3 Operations

```go
f.UploadToS3(bucket, key string) error
f.UploadToS3WithContext(ctx context.Context, bucket, key string) error
f.DownloadFromS3(bucket, key string) error
f.DownloadFromS3WithContext(ctx context.Context, bucket, key string) error
f.GetSignedURL(expiresIn time.Duration) (string, error)
f.GetSignedURLWithContext(ctx context.Context, expiresIn time.Duration) (string, error)
```

### Checksum

```go
f.Checksum() (string, error)   // SHA-256 hex digest
```

### Testing

The package variables `S3ClientFactory` and `HTTPClient` can be replaced to inject test doubles:

```go
// Inject a mock S3 client
file.S3ClientFactory = func() (file.S3API, file.S3PresignAPI) {
    return myMockS3Client, myMockPresignClient
}

// Inject a test HTTP server client
file.HTTPClient = myHTTPTestClient
```

## Built With

- Go 1.21+
- [aws-sdk-go-v2](https://github.com/aws/aws-sdk-go-v2) — AWS SDK for S3 integration
- Standard library `net/http`, `io`, `os`, `crypto/sha256`

## Related Packages

- [@smooai/file](https://www.npmjs.com/package/@smooai/file) — TypeScript/Node.js version
- [smooai-file (Python)](https://pypi.org/project/smooai-file/) — Python version
- [smooai-file (Rust)](https://crates.io/crates/smooai-file) — Rust version

## Development

### Running tests

```bash
go test ./...
```

### Running tests with race detector

```bash
go test -race ./...
```

### Linting

```bash
go vet ./...
```

<!-- CONTACT -->

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Brent Rager

- [Email](mailto:brent@smoo.ai)
- [LinkedIn](https://www.linkedin.com/in/brentrager/)
- [BlueSky](https://bsky.app/profile/brentragertech.bsky.social)

Smoo Github: [https://github.com/SmooAI](https://github.com/SmooAI)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

MIT © SmooAI
