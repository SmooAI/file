<a name="readme-top"></a>

<p align="center">
  <a href="https://smoo.ai"><img src="https://smoo.ai/images/logo/logo.svg" alt="Smoo AI" width="220" /></a>
</p>

<h1 align="center">@smooai/file</h1>

<p align="center">
  <strong>File operations that don't lie — magic-byte MIME detection, built-in validation, and one-call presigned S3 uploads, all stream-first.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@smooai/file"><img src="https://img.shields.io/npm/v/@smooai/file?style=flat-square&color=00A6A6&label=npm" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@smooai/file"><img src="https://img.shields.io/npm/dw/@smooai/file?style=flat-square&color=F49F0A&label=downloads" alt="downloads"></a>
  <img src="https://img.shields.io/badge/Smoo_AI-platform-00A6A6?style=flat-square" alt="Smoo AI">
  <img src="https://img.shields.io/badge/license-MIT-F49F0A?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/.NET-512BD4?style=flat-square&logo=dotnet&logoColor=white" alt=".NET">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#part-of-smoo-ai">Platform</a>
</p>

---

> A file abstraction that trusts the bytes, not the extension. Built for backends that take uploads from the open internet: magic-byte MIME detection, size and content validation, and presigned S3 uploads — all stream-first, so a 2 GB upload never buffers into your Lambda memory.

## ✨ Features <a name="features"></a>

#### 🔒 Trust the bytes, not the extension

Magic-byte MIME detection catches spoofed uploads. A `.php` renamed to `avatar.png` fails validation because the bytes disagree with the claim.

- Magic-byte detection across 100+ file types
- `FileContentMismatchError` when client-claimed MIME disagrees with the bytes
- `FileSizeError` / `FileMimeError` for oversize or disallowed uploads
- One `validate()` call, typed error types, map cleanly to HTTP 400

#### ☁️ S3 in one call

- Stream any file (local, URL, Blob) straight into S3
- Pull S3 objects back through the same validation pipeline
- Presigned upload URLs with `maxSize` baked into the signature, so oversized uploads are rejected by S3 before they hit you

#### 🌐 One API, many sources

Local filesystem, URL download, S3 object, multipart FormData, or a browser `File`/`Blob` — all resolve to the same `File` instance with the same validation and metadata surface.

#### 🚀 Stream-first under the hood

Bytes load lazily so a 2 GB upload doesn't buffer into memory. Automatic handling across Node.js and Web streams — you never have to pick the right pipe.

#### 📝 Rich metadata

File name, real (detected) MIME type, size, created/modified timestamps, hash/checksum, source type — all on one object.

## 📦 Install <a name="install"></a>

```sh
pnpm add @smooai/file
```

### Multi-language support

@smooai/file ships as native implementations in **TypeScript**, **Python**, **Rust**, **Go**, and **.NET (C#)** — each built with idiomatic patterns for its ecosystem.

| Language    | Package                                                           | Install                                 |
| ----------- | ----------------------------------------------------------------- | --------------------------------------- |
| TypeScript  | [`@smooai/file`](https://www.npmjs.com/package/@smooai/file)      | `pnpm add @smooai/file`                 |
| Python      | [`smooai-file`](https://pypi.org/project/smooai-file/)            | `pip install smooai-file`               |
| Rust        | [`smooai-file`](https://crates.io/crates/smooai-file)             | `cargo add smooai-file`                 |
| Go          | `github.com/SmooAI/file/go/file`                                  | `go get github.com/SmooAI/file/go/file` |
| .NET (core) | [`SmooAI.File`](https://www.nuget.org/packages/SmooAI.File)       | `dotnet add package SmooAI.File`        |
| .NET (S3)   | [`SmooAI.File.S3`](https://www.nuget.org/packages/SmooAI.File.S3) | `dotnet add package SmooAI.File.S3`     |

Language-specific source lives in the [`python/`](./python/), [`rust/`](./rust/), [`go/`](./go/), and [`dotnet/`](./dotnet/) directories.

The .NET port uses [Mime-Detective](https://github.com/MediatedCommunications/Mime-Detective) for magic-byte MIME sniffing and splits S3 helpers into a sub-package, so consumers who don't need AWS avoid pulling in the AWS SDK.

## 🚀 Usage <a name="usage"></a>

Jump to a pattern:

- [Basic usage](#basic-usage)
- [Streaming operations](#streaming-operations)
- [S3 integration](#s3-integration)
- [File type detection](#file-type-detection)
- [FormData support](#formdata-support)
- [Web File / Blob (Hono, Next.js, Browser)](#web-file)
- [Validation (size, mime, content-vs-claim)](#validation)
- [Base64 encoding](#base64)
- [Presigned upload URL](#presigned-upload)

#### Basic usage <a name="basic-usage"></a>

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

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### Streaming operations <a name="streaming-operations"></a>

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

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### S3 integration <a name="s3-integration"></a>

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

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### File type detection <a name="file-type-detection"></a>

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

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### FormData support <a name="formdata-support"></a>

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

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### Web File / Blob (Hono, Next.js, Browser) <a name="web-file"></a>

```typescript
import File from '@smooai/file';

// Hono multipart route
app.post('/upload', async (c) => {
    const form = await c.req.formData();
    const webFile = form.get('file') as globalThis.File;

    // Preserves the web File's name and type hints.
    const file = await File.createFromWebFile(webFile);
    // …validate, upload, etc.
});
```

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### Validation (size, mime, content-vs-claim) <a name="validation"></a>

```typescript
import File, { FileValidationError } from '@smooai/file';

const file = await File.createFromWebFile(webFile);

try {
    await file.validate({
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
        expectedMimeType: webFile.type, // compares magic-byte detection vs claimed Content-Type
    });
} catch (err) {
    if (err instanceof FileValidationError) {
        // FileSizeError | FileMimeError | FileContentMismatchError — map to HTTP 400
        throw new HTTPException(400, { message: err.message });
    }
    throw err;
}
```

`expectedMimeType` is the primary defense against mime-spoofing: a `.php` file uploaded with `Content-Type: image/png` will fail because magic-byte detection doesn't match the claim.

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### Base64 encoding (email attachments, data URLs) <a name="base64"></a>

```typescript
import File from '@smooai/file';

const file = await File.createFromUrl('https://s3.example.com/invoice.pdf');

await sendEmail({
    attachments: [
        {
            filename: 'invoice.pdf',
            content: await file.toBase64(),
            encoding: 'base64',
        },
    ],
});
```

<p align="right">(<a href="#usage">back to usage</a>)</p>

#### Presigned upload URL (server signs, client uploads direct to S3) <a name="presigned-upload"></a>

```typescript
import File from '@smooai/file';

// Server issues a time-limited signed URL the client uploads bytes to directly.
// `maxSize` is baked into the signature so oversized uploads are rejected by S3.
const url = await File.createPresignedUploadUrl({
    bucket: Resource.Bucket.name,
    key: `avatars/${userId}.png`,
    contentType: 'image/png',
    expiresIn: 600,
    maxSize: 2 * 1024 * 1024,
});
```

<p align="right">(<a href="#usage">back to usage</a>)</p>

## 🔧 Built with

- TypeScript
- Node.js File System API
- AWS SDK v3
- [file-type](https://github.com/sindresorhus/file-type) for magic number-based MIME type detection
- [@smooai/fetch](https://github.com/SmooAI/fetch) for URL downloads
- [@smooai/logger](https://github.com/SmooAI/logger) for structured logging

## 🧩 Part of Smoo AI <a name="part-of-smoo-ai"></a>

@smooai/file is part of the [Smoo AI](https://smoo.ai) platform — an AI-powered business platform with AI built into every product. It's one of a small family of open-source packages we maintain to keep our own stack honest. Use them in your stack, or take them as a reference for how we build.

- [@smooai/fetch](https://github.com/SmooAI/fetch) — typed HTTP with retries and structured errors
- [@smooai/logger](https://github.com/SmooAI/logger) — contextual structured logging
- [@smooai/config](https://github.com/SmooAI/config) — typed config, secrets, and feature flags
- [smooth](https://github.com/SmooAI/smooth) — the agent orchestration toolkit

Browse everything at [smoo.ai/open-source](https://smoo.ai/open-source) and [github.com/SmooAI](https://github.com/SmooAI).

## 🤝 Contributing <a name="contributing"></a>

Contributions are welcome. This project uses [changesets](https://github.com/changesets/changesets) to manage versions and releases.

#### Development workflow

1. Fork the repository
2. Create your branch (`git checkout -b amazing-feature`)
3. Make your changes
4. Add a changeset to document them:

    ```sh
    pnpm changeset
    ```

    You'll be prompted to choose a version bump (patch, minor, or major) and describe the change.

5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a pull request — reference any related issues in the description

The maintainers will review your PR and may request changes before merging.

## 📄 License <a name="license"></a>

MIT — see [LICENSE](./LICENSE).

## 📬 Contact

Brent Rager

- [Email](mailto:brent@smoo.ai)
- [LinkedIn](https://www.linkedin.com/in/brentrager/)
- [BlueSky](https://bsky.app/profile/brentragertech.bsky.social)
- [TikTok](https://www.tiktok.com/@brentragertech)
- [Instagram](https://www.instagram.com/brentragertech/)

Smoo GitHub: [https://github.com/SmooAI](https://github.com/SmooAI)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<p align="center">
  Built by <a href="https://smoo.ai"><strong>Smoo AI</strong></a> — AI built into every product.
</p>
