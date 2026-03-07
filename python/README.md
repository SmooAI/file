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
    <img src="../../images/logo.png" alt="SmooAI Logo" />
  </a>
</div>

<!-- ABOUT THE PROJECT -->

## About SmooAI

SmooAI is an AI-powered platform for helping businesses multiply their customer, employee, and developer experience.

Learn more on [smoo.ai](https://smoo.ai)

## SmooAI Packages

Check out other SmooAI packages at [smoo.ai/open-source](https://smoo.ai/open-source)

## About smooai-file (Python)

A powerful file handling library for Python that provides a unified async interface for working with files from local filesystem, S3, URLs, bytes, and streams. Built stream-first for memory efficiency — file bytes are handled lazily where possible to minimize memory pressure and improve performance.

![PyPI Version](https://img.shields.io/pypi/v/smooai-file?style=for-the-badge)
![PyPI Downloads](https://img.shields.io/pypi/dw/smooai-file?style=for-the-badge)
![PyPI Last Update](https://img.shields.io/pypi/last-update/smooai-file?style=for-the-badge)

![GitHub License](https://img.shields.io/github/license/SmooAI/file?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/SmooAI/file/release.yml?style=for-the-badge)
![GitHub Repo stars](https://img.shields.io/github/stars/SmooAI/file?style=for-the-badge)

### Python Package

This is the Python port of [@smooai/file](https://www.npmjs.com/package/@smooai/file), mirroring the feature set of the TypeScript version with idiomatic async/await Python. The package provides the same unified `File` class with automatic MIME type detection, rich metadata, and full S3 integration.

### Install

```bash
pip install smooai-file
```

or with [uv](https://docs.astral.sh/uv/):

```bash
uv add smooai-file
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

- Async-native with `asyncio` throughout
- Memory-efficient processing via `aiofiles`
- Supports both async iterators and sync file-like objects
- Lazy byte handling wherever possible

#### Multiple File Sources

- **Local Filesystem** — async read/write with `aiofiles`, stat metadata
- **URLs** — automatic download via `httpx`, header metadata extraction
- **S3 Objects** — direct AWS S3 integration (download and upload) via `boto3`, ETag and Content-Type extraction
- **Bytes** — in-memory buffers with full metadata support
- **Streams** — async iterators and sync file-like objects

#### Intelligent File Type Detection

Automatic MIME type and extension detection using a priority cascade:

1. Magic-byte inspection of file contents
2. HTTP response headers (`Content-Type`, `Content-Disposition`)
3. S3 object metadata
4. File extension fallback

#### Rich Metadata

- File name and extension
- MIME type
- File size
- Last modified and created timestamps
- SHA-256 (and other algorithm) checksums
- URL and filesystem path
- Source type (`FILE`, `URL`, `S3`, `BYTES`, `STREAM`)

### Examples

- [Basic Usage](#basic-usage)
- [URL Download](#url-download)
- [S3 Integration](#s3-integration)
- [Stream Handling](#stream-handling)
- [File Operations](#file-operations)

#### Basic Usage <a name="basic-usage"></a>

```python
import asyncio
from smooai_file import File

async def main():
    # Create from a local path
    file = await File.from_file("/path/to/document.pdf")

    # Read contents
    content = await file.read()          # bytes
    text = await file.read_text()        # str (UTF-8)

    # Access metadata
    print(file.name)           # "document.pdf"
    print(file.mime_type)      # "application/pdf"
    print(file.size)           # 102400
    print(file.extension)      # "pdf"
    print(file.path)           # "/path/to/document.pdf"
    print(file.last_modified)  # datetime(...)

asyncio.run(main())
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### URL Download <a name="url-download"></a>

```python
import asyncio
from smooai_file import File

async def main():
    # Fetch from a URL (uses httpx under the hood)
    file = await File.from_url("https://example.com/report.pdf")

    # MIME type detected from Content-Type header and magic bytes
    print(file.mime_type)   # "application/pdf"
    print(file.size)        # populated from Content-Length header

    # Save to disk
    original, saved = await file.save("/tmp/report.pdf")
    print(saved.path)       # "/tmp/report.pdf"

asyncio.run(main())
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### S3 Integration <a name="s3-integration"></a>

```python
import asyncio
from smooai_file import File

async def main():
    # Download from S3
    file = await File.from_s3("my-bucket", "reports/report.pdf")

    # Upload to S3 (sets ContentType, ContentLength, ContentDisposition)
    await file.upload_to_s3("my-bucket", "archive/report.pdf")

    # Save to S3 and get a new S3-backed File instance
    original, s3_file = await file.save_to_s3("my-bucket", "archive/report.pdf")

    # Move to S3 (deletes local source if applicable)
    s3_file = await file.move_to_s3("my-bucket", "archive/report.pdf")

    # Generate a pre-signed URL (expires in 1 hour)
    signed_url = await s3_file.get_signed_url(expires_in=3600)
    print(signed_url)

asyncio.run(main())
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### Stream Handling <a name="stream-handling"></a>

```python
import asyncio
from smooai_file import File

async def my_async_generator():
    yield b"hello "
    yield b"world"

async def main():
    # From an async iterator
    file = await File.from_stream(my_async_generator())
    text = await file.read_text()
    print(text)   # "hello world"

    # From a sync file-like object
    with open("/path/to/file.bin", "rb") as f:
        file = await File.from_stream(f)
    print(file.mime_type)

asyncio.run(main())
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### File Operations <a name="file-operations"></a>

```python
import asyncio
from smooai_file import File

async def main():
    file = await File.from_file("/tmp/notes.txt")

    # Append and prepend (local files only)
    await file.append("new line\n")
    await file.prepend("# Header\n")

    # Truncate to 1 KB
    await file.truncate(1024)

    # Compute checksum
    digest = await file.checksum("sha256")
    print(digest)   # 64-char hex string

    # Filesystem checks
    print(await file.exists())       # True
    print(await file.is_readable())  # True
    print(await file.is_writable())  # True

    # Move to a new location (deletes source)
    moved = await file.move("/tmp/archive/notes.txt")

    # Delete
    await moved.delete()

asyncio.run(main())
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

### Built With

- Python 3.11+ with full type hints
- [aiofiles](https://github.com/Tinche/aiofiles) — async filesystem I/O
- [httpx](https://www.python-httpx.org/) — async HTTP client for URL downloads
- [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html) — AWS SDK for S3 integration
- [python-magic](https://github.com/ahupp/python-magic) — magic-byte MIME detection

## Related Packages

- [@smooai/file](https://www.npmjs.com/package/@smooai/file) — TypeScript/Node.js version
- [smooai-file (Rust)](https://crates.io/crates/smooai-file) — Rust version
- `github.com/SmooAI/file/go/file` — Go version

## Development

```bash
uv sync
uv run poe install-dev
uv run pytest
uv run poe lint
uv run poe lint:fix   # optional fixer
uv run poe format
uv run poe typecheck
uv run poe build
```

Set `UV_PUBLISH_TOKEN` before running `uv run poe publish` to upload to PyPI.

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
