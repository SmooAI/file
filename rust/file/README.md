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

## About smooai-file (Rust)

**File operations that don't lie** — magic-byte MIME detection catches spoofed extensions, size + content validation is built in, and local / URL / S3 / bytes / stream sources all speak the same typed async API. Stream-first and zero-copy where it counts, so large uploads don't buffer into memory.

![Crates.io Version](https://img.shields.io/crates/v/smooai-file?style=for-the-badge)
![Crates.io Downloads](https://img.shields.io/crates/d/smooai-file?style=for-the-badge)
![Crates.io License](https://img.shields.io/crates/l/smooai-file?style=for-the-badge)

![GitHub License](https://img.shields.io/github/license/SmooAI/file?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/SmooAI/file/release.yml?style=for-the-badge)
![GitHub Repo stars](https://img.shields.io/github/stars/SmooAI/file?style=for-the-badge)

### Rust Crate

A Rust port of [@smooai/file](https://www.npmjs.com/package/@smooai/file) that mirrors the feature set of the TypeScript and Python versions. The crate exposes a single `File` struct with async constructors for every supported source, rich metadata extraction, and full AWS S3 integration via the AWS SDK for Rust.

### Install

```toml
[dependencies]
smooai-file = "1"
```

Or via cargo:

```bash
cargo add smooai-file
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

#### Stream-First Design

- Async-native with Tokio throughout
- Zero-copy `bytes::Bytes` for in-memory data
- Streams consumed via `futures::StreamExt` with minimal allocation
- Memory-efficient S3 body collection

#### Multiple File Sources

- **Local Filesystem** — async read with `tokio::fs`, stat metadata (size, modified, created)
- **URLs** — automatic download via `reqwest`, header metadata extraction
- **S3 Objects** — direct AWS S3 integration via the AWS SDK for Rust, ETag and Content-Type extraction
- **Bytes** — `bytes::Bytes` buffers with full metadata support
- **Streams** — any `futures::Stream<Item = Result<Bytes, io::Error>>`

#### Intelligent File Type Detection

Automatic MIME type and extension detection using a priority cascade:

1. Magic-byte inspection of file contents
2. HTTP response headers (`Content-Type`, `Content-Disposition`, `ETag`)
3. S3 object metadata
4. Filename/extension fallback via `mime_guess`

#### Rich Metadata

- File name and extension
- MIME type
- File size in bytes
- Last modified and created timestamps (`chrono::DateTime<Utc>`)
- SHA-256 checksum
- URL and filesystem path
- Source type (`File`, `Url`, `Bytes`, `Stream`, `S3`)

### Examples

- [Basic Usage](#basic-usage)
- [URL Download](#url-download)
- [S3 Integration](#s3-integration)
- [Stream Handling](#stream-handling)
- [File Operations](#file-operations)

#### Basic Usage <a name="basic-usage"></a>

```rust
use smooai_file::File;

#[tokio::main]
async fn main() -> smooai_file::error::Result<()> {
    // Create from a local path
    let file = File::from_file("/path/to/document.pdf", None).await?;

    // Read contents
    let bytes = file.read().await?;          // bytes::Bytes
    let text = file.read_text().await?;      // String (UTF-8)

    // Access metadata
    println!("{:?}", file.name());           // Some("document.pdf")
    println!("{:?}", file.mime_type());      // Some("application/pdf")
    println!("{:?}", file.size());           // Some(102400)
    println!("{:?}", file.extension());      // Some("pdf")
    println!("{:?}", file.path());           // Some("/path/to/document.pdf")
    println!("{:?}", file.last_modified());  // Some(DateTime<Utc>)

    Ok(())
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### URL Download <a name="url-download"></a>

```rust
use smooai_file::File;

#[tokio::main]
async fn main() -> smooai_file::error::Result<()> {
    // Fetch from a URL (uses reqwest under the hood)
    let file = File::from_url("https://example.com/report.pdf", None).await?;

    // MIME type detected from Content-Type header and magic bytes
    println!("{:?}", file.mime_type());   // Some("application/pdf")
    println!("{:?}", file.size());        // Some(102400) from Content-Length header

    // Save to disk -- returns (original, saved_copy)
    let (_, saved) = file.save("/tmp/report.pdf").await?;
    println!("{:?}", saved.path());       // Some("/tmp/report.pdf")

    Ok(())
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### S3 Integration <a name="s3-integration"></a>

```rust
use smooai_file::File;

#[tokio::main]
async fn main() -> smooai_file::error::Result<()> {
    // Download from S3 (AWS credentials loaded from environment)
    let file = File::from_s3("my-bucket", "reports/report.pdf", None).await?;

    // Upload to S3 (sets ContentType, ContentLength, ContentDisposition)
    file.upload_to_s3("my-bucket", "archive/report.pdf").await?;

    // Generate a presigned URL (expires in 1 hour)
    let s3_file = File::from_s3("my-bucket", "reports/report.pdf", None).await?;
    let signed_url = s3_file.get_signed_url(3600).await?;
    println!("{}", signed_url);

    Ok(())
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### Stream Handling <a name="stream-handling"></a>

```rust
use bytes::Bytes;
use futures::stream;
use smooai_file::File;

#[tokio::main]
async fn main() -> smooai_file::error::Result<()> {
    // Create from a futures::Stream
    let chunks = vec![
        Ok(Bytes::from("hello ")),
        Ok(Bytes::from("world")),
    ];
    let s = stream::iter(chunks);

    let file = File::from_stream(s, None).await?;
    let text = file.read_text().await?;
    println!("{}", text);          // "hello world"
    println!("{:?}", file.size()); // Some(11)

    Ok(())
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### File Operations <a name="file-operations"></a>

```rust
use bytes::Bytes;
use smooai_file::{File, MetadataHint};

#[tokio::main]
async fn main() -> smooai_file::error::Result<()> {
    let file = File::from_bytes(Bytes::from("hello world"), None).await?;

    // Compute SHA-256 checksum
    let digest = file.checksum().await?;
    println!("{}", digest);   // 64-char hex string

    // Save to filesystem -- returns (original, saved copy)
    let (_, saved) = file.save("/tmp/greeting.txt").await?;
    println!("{:?}", saved.path());

    // Move to a new location (deletes source if filesystem-sourced)
    let moved = saved.move_to("/tmp/archive/greeting.txt").await?;

    // Delete from filesystem
    moved.delete().await?;

    // Update metadata
    let mut file = File::from_bytes(Bytes::from("data"), None).await?;
    file.set_metadata(MetadataHint {
        name: Some("data.bin".to_string()),
        mime_type: Some("application/octet-stream".to_string()),
        ..Default::default()
    });

    Ok(())
}
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

## API Reference

### Constructors

```rust
// From bytes::Bytes
File::from_bytes(data: Bytes, hint: Option<MetadataHint>) -> Result<File>

// From local filesystem path
File::from_file<P: AsRef<Path>>(path: P, hint: Option<MetadataHint>) -> Result<File>

// From HTTP/HTTPS URL (uses reqwest)
File::from_url(url: &str, hint: Option<MetadataHint>) -> Result<File>

// From async stream
File::from_stream<S: Stream<Item = Result<Bytes, io::Error>>>(stream: S, hint: Option<MetadataHint>) -> Result<File>

// From S3 (loads AWS config from environment)
File::from_s3(bucket: &str, key: &str, hint: Option<MetadataHint>) -> Result<File>

// From S3 with an injected client (useful for testing)
File::from_s3_with_client(client: &S3Client, bucket: &str, key: &str, hint: Option<MetadataHint>) -> Result<File>
```

### Accessors

```rust
file.source()        -> FileSource
file.metadata()      -> &Metadata
file.name()          -> Option<&str>
file.mime_type()     -> Option<&str>
file.size()          -> Option<u64>
file.extension()     -> Option<&str>
file.url()           -> Option<&str>
file.path()          -> Option<&str>
file.hash()          -> Option<&str>
file.last_modified() -> Option<DateTime<Utc>>
file.created_at()    -> Option<DateTime<Utc>>
```

### Read Operations

```rust
file.read()       -> Result<Bytes>   // raw bytes
file.read_text()  -> Result<String>  // UTF-8 string
```

### Write Operations

```rust
file.save(destination: &str)     -> Result<(File, File)>   // (original, saved copy)
file.move_to(destination: &str)  -> Result<File>           // moves, deletes source if filesystem
file.delete()                    -> Result<()>              // filesystem files only
```

### S3 Operations

```rust
file.upload_to_s3(bucket: &str, key: &str)                       -> Result<()>
file.upload_to_s3_with_client(client, bucket, key)               -> Result<()>
File::download_from_s3(bucket: &str, key: &str)                  -> Result<File>
File::download_from_s3_with_client(client, bucket, key)          -> Result<File>
file.get_signed_url(expires_in_secs: u64)                        -> Result<String>
file.get_signed_url_with_client(client, bucket, key, expires_in) -> Result<String>
```

### Checksum

```rust
file.checksum() -> Result<String>   // SHA-256 hex digest
```

## Built With

- Rust 2021 Edition — memory safety and performance
- [Tokio](https://tokio.rs/) — async runtime
- [bytes](https://docs.rs/bytes) — zero-copy byte buffers
- [reqwest](https://docs.rs/reqwest) — HTTP client for URL downloads
- [aws-sdk-s3](https://docs.rs/aws-sdk-s3) — AWS SDK for S3 integration
- [sha2](https://docs.rs/sha2) — SHA-256 checksums
- [mime_guess](https://docs.rs/mime_guess) — MIME type inference from filenames
- [serde](https://serde.rs/) — serialization for metadata

## Related Packages

- [@smooai/file](https://www.npmjs.com/package/@smooai/file) — TypeScript/Node.js version
- [smooai-file (Python)](https://pypi.org/project/smooai-file/) — Python version
- `github.com/SmooAI/file/go/file` — Go version

## Development

### Running tests

```bash
cargo test
```

### Building

```bash
cargo build --release
```

### Linting and Formatting

```bash
cargo clippy
cargo fmt
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
