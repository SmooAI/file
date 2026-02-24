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
    <img src="images/logo.png" alt="SmooAI Logo" />
  </a>
</div>

<!-- ABOUT THE PROJECT -->

## About SmooAI

SmooAI is an AI-powered platform for helping businesses multiply their customer, employee, and developer experience.

Learn more on [smoo.ai](https://smoo.ai)

## SmooAI Packages

Check out other SmooAI packages at [smoo.ai/open-source](https://smoo.ai/open-source)

## About @smooai/file

A powerful file handling library for Node.js that provides a unified interface for working with files from local filesystem, S3, URLs, and more. Built with streaming in mind, it handles file bytes lazily where possible to minimize memory usage and improve performance.

![NPM Version](https://img.shields.io/npm/v/%40smooai%2Ffile?style=for-the-badge)
![NPM Downloads](https://img.shields.io/npm/dw/%40smooai%2Ffile?style=for-the-badge)
![NPM Last Update](https://img.shields.io/npm/last-update/%40smooai%2Ffile?style=for-the-badge)

![GitHub License](https://img.shields.io/github/license/SmooAI/file?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/SmooAI/file/release.yml?style=for-the-badge)
![GitHub Repo stars](https://img.shields.io/github/stars/SmooAI/file?style=for-the-badge)

### Install

```sh
pnpm add @smooai/file
```

### Multi-Language Support

@smooai/file is available as native implementations in **TypeScript**, **Python**, **Rust**, and **Go** — each built with idiomatic patterns for its ecosystem.

| Language   | Package                                                      | Install                                 |
| ---------- | ------------------------------------------------------------ | --------------------------------------- |
| TypeScript | [`@smooai/file`](https://www.npmjs.com/package/@smooai/file) | `pnpm add @smooai/file`                 |
| Python     | [`smooai-file`](https://pypi.org/project/smooai-file/)       | `pip install smooai-file`               |
| Rust       | [`smooai-file`](https://crates.io/crates/smooai-file)        | `cargo add smooai-file`                 |
| Go         | `github.com/SmooAI/file/go/file`                             | `go get github.com/SmooAI/file/go/file` |

Language-specific source code lives in the [`python/`](./python/), [`rust/`](./rust/), and [`go/`](./go/) directories.

### Key Features

#### 🚀 Stream-First Design

- Lazy loading of file contents
- Memory-efficient processing
- Automatic stream handling
- Support for both Node.js and Web streams

#### 📦 Multiple File Sources

- **Local Filesystem**
    - Read and write operations
    - File system checks
    - Metadata extraction

- **URLs**
    - Automatic download
    - Stream-based transfer
    - Header metadata extraction

- **S3 Objects**
    - Direct S3 integration (download and upload)
    - Stream-based transfer
    - Header metadata extraction
    - Signed URL generation

- **FormData**
    - Ease of use for Multipart FormData upload

#### 🔍 Intelligent File Type Detection

Powered by [file-type](https://github.com/sindresorhus/file-type), providing:

- Magic number detection
- MIME type inference
- File extension detection
- Support for 100+ file types

#### 📝 Rich Metadata

- File name and extension
- MIME type detection
- File size
- Last modified date
- Creation date
- File hash/checksum
- URL and path information
- Source type

### Examples

- [Basic Usage](#basic-usage)
- [Streaming Operations](#streaming-operations)
- [S3 Integration](#s3-integration)
- [File Type Detection](#file-type-detection)
- [FormData Support](#formdata-support)

#### Basic Usage <a name="basic-usage"></a>

```typescript
import File from '@smooai/file';

// Create a file from a local path
const file = await File.createFromFile('path/to/file.txt');

// Read file contents (streams automatically)
const content = await file.readFileString();
console.log(content);

// Get file metadata
console.log(file.metadata);
// {
//   name: 'file.txt',
//   mimeType: 'text/plain',
//   size: 1234,
//   extension: 'txt',
//   path: 'path/to/file.txt',
//   lastModified: Date,
//   createdAt: Date
// }
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### Streaming Operations <a name="streaming-operations"></a>

```typescript
import File from '@smooai/file';

// Create a file from a URL (streams automatically)
const file = await File.createFromUrl('https://example.com/large-file.zip');

// Pipe to a destination (streams without loading entire file)
await file.pipeTo(someWritableStream);

// Read as bytes (streams in chunks)
const bytes = await file.readFileBytes();

// Save to filesystem (streams directly)
const { original, newFile } = await file.saveToFile('downloads/file.zip');
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### S3 Integration <a name="s3-integration"></a>

```typescript
import File from '@smooai/file';

// Create from S3 (streams automatically)
const file = await File.createFromS3('my-bucket', 'path/to/file.jpg');

// Upload to S3 (streams directly)
await file.uploadToS3('my-bucket', 'remote/file.jpg');

// Save to S3 (creates new file instance)
const { original, newFile } = await file.saveToS3('my-bucket', 'remote/file.jpg');

// Move to S3 (deletes local file if source was local)
const s3File = await file.moveToS3('my-bucket', 'remote/file.jpg');

// Generate signed URL
const signedUrl = await s3File.getSignedUrl(3600); // URL expires in 1 hour
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### File Type Detection <a name="file-type-detection"></a>

```typescript
import File from '@smooai/file';

const file = await File.createFromFile('document.xml');

// Get file type information (detected via magic numbers)
console.log(file.mimeType); // 'application/xml'
console.log(file.extension); // 'xml'

// File type is automatically detected from:
// - Magic numbers (via file-type)
// - MIME type headers
// - File extension
// - Custom detectors
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

#### FormData Support <a name="formdata-support"></a>

```typescript
import File from '@smooai/file';

const file = await File.createFromFile('document.pdf');

// Convert to FormData for uploads
const formData = await file.toFormData('document');

// Use with fetch or other HTTP clients
await fetch('https://api.example.com/upload', {
    method: 'POST',
    body: formData,
});
```

<p align="right">(<a href="#examples">back to examples</a>)</p>

### Built With

- TypeScript
- Node.js File System API
- AWS SDK v3
- [file-type](https://github.com/sindresorhus/file-type) for magic number-based MIME type detection
- [@smooai/fetch](https://github.com/SmooAI/fetch) for URL downloads
- [@smooai/logger](https://github.com/SmooAI/logger) for structured logging

## Contributing

Contributions are welcome! This project uses [changesets](https://github.com/changesets/changesets) to manage versions and releases.

### Development Workflow

1. Fork the repository
2. Create your branch (`git checkout -b amazing-feature`)
3. Make your changes
4. Add a changeset to document your changes:

    ```sh
    pnpm changeset
    ```

    This will prompt you to:
    - Choose the type of version bump (patch, minor, or major)
    - Provide a description of the changes

5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Pull Request Guidelines

- Reference any related issues in your PR description

The maintainers will review your PR and may request changes before merging.

<!-- CONTACT -->

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Brent Rager

- [Email](mailto:brent@smoo.ai)
- [LinkedIn](https://www.linkedin.com/in/brentrager/)
- [BlueSky](https://bsky.app/profile/brentragertech.bsky.social)
- [TikTok](https://www.tiktok.com/@brentragertech)
- [Instagram](https://www.instagram.com/brentragertech/)

Smoo Github: [https://github.com/SmooAI](https://github.com/SmooAI)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[sst.dev-url]: https://reactjs.org/
[sst]: https://img.shields.io/badge/sst-EDE1DA?style=for-the-badge&logo=sst&logoColor=E27152
[sst-url]: https://sst.dev/
[next]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[next-url]: https://nextjs.org/
[aws]: https://img.shields.io/badge/aws-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white
[aws-url]: https://tailwindcss.com/
[tailwindcss]: https://img.shields.io/badge/tailwind%20css-0B1120?style=for-the-badge&logo=tailwindcss&logoColor=#06B6D4
[tailwindcss-url]: https://tailwindcss.com/
[zod]: https://img.shields.io/badge/zod-3E67B1?style=for-the-badge&logoColor=3E67B1
[zod-url]: https://zod.dev/
[sanity]: https://img.shields.io/badge/sanity-F36458?style=for-the-badge
[sanity-url]: https://www.sanity.io/
[vitest]: https://img.shields.io/badge/vitest-1E1E20?style=for-the-badge&logo=vitest&logoColor=#6E9F18
[vitest-url]: https://vitest.dev/
[pnpm]: https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white
[pnpm-url]: https://pnpm.io/
[turborepo]: https://img.shields.io/badge/turborepo-000000?style=for-the-badge&logo=turborepo&logoColor=#EF4444
[turborepo-url]: https://turbo.build/
