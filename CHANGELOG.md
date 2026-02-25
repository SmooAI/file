# @smooai/file

## 2.0.0

### Major Changes

- 6b5b8e2: Implement file library in Python, Rust, and Go
    - Python: Async file handling with puremagic detection, S3 via boto3, aiofiles, metadata pipeline matching TypeScript (98 tests)
    - Rust: File handling with infer + custom SVG/XML detection, aws-sdk-s3, SHA-256 checksums, Content-Disposition parsing (99 tests)
    - Go: File handling with gabriel-vasile/mimetype detection, aws-sdk-go-v2 for S3, dependency injection for testability (121 tests)

## 1.1.5

### Patch Changes

- 1b2aebd: Fix bug with S3Client usage.
- e59d9a1: Add SmooAI Packages section to README with link to smoo.ai/open-source for consistency across all SmooAI packages.

## 1.1.4

### Patch Changes

- f3ca33c: Fix bug with S3Client usage.

## 1.1.3

### Patch Changes

- c701114: Update @smooai/logger and other smoo dependencies.

## 1.1.2

### Patch Changes

- ffc04a8: Updating smoo dependencies.

## 1.1.1

### Patch Changes

- 342c972: Updating smoo dependencies.

## 1.1.0

### Minor Changes

- a18b3e7: Fix package exports.

## 1.0.7

### Patch Changes

- a4dae2d: Update readme.

## 1.0.6

### Patch Changes

- 32ed390: Update prettier plugins.

## 1.0.5

### Patch Changes

- a0b764f: Added JSDoc to public interfaces.

## 1.0.4

### Patch Changes

- f06c94a: Update to publish to npm.

## 1.0.3

### Patch Changes

- 3b2c36a: Adding fully tested File library ready for publishing.

## 1.0.2

### Patch Changes

- 44fd23b: Fix publish for Github releases.

## 1.0.1

### Patch Changes

- 52c9eb1: Initial check-in.
