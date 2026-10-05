//! SmooAI File Library for Rust.
//!
//! A unified file handling library for working with files from local filesystem,
//! S3, URLs, and streams.
//!
//! # Overview
//!
//! This crate provides the [`File`] struct, a single type that can represent
//! files from multiple sources:
//!
//! - **URLs**: HTTP/HTTPS resources
//! - **Local filesystem**: Paths on disk
//! - **Bytes**: In-memory byte buffers
//! - **Streams**: Async byte streams
//! - **Amazon S3**: Objects in S3 buckets
//!
//! # Features
//!
//! - `file` (default): the I/O [`File`] type and its sources. Without it
//!   (`default-features = false`) the crate is just [`detection`],
//!   [`content_disposition`] and the [`error`] types — no AWS SDK, reqwest or
//!   tokio.
//!
//! # Examples
//!
//! Sniffing bytes you already hold (no features needed):
//!
//! ```
//! use smooai_file::detection::detect_from_bytes;
//!
//! let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];
//! assert_eq!(detect_from_bytes(&png, None).mime_type.as_deref(), Some("image/png"));
//! ```
#![cfg_attr(
    feature = "file",
    doc = r#"
With the `file` feature:

```no_run
# use smooai_file::File;
# use bytes::Bytes;
# async fn example() -> smooai_file::error::Result<()> {
let file = File::from_bytes(Bytes::from("hello world"), None).await?;
let text = file.read_text().await?;
assert_eq!(text, "hello world");
# Ok(())
# }
```
"#
)]

pub mod content_disposition;
pub mod detection;
pub mod error;
#[cfg(feature = "file")]
pub mod file;
#[cfg(feature = "file")]
pub mod metadata;
#[cfg(feature = "file")]
pub mod source;

// Re-export primary types at the crate root for convenience.
pub use crate::error::{FileError, FileValidationError};
#[cfg(feature = "file")]
pub use crate::file::{File, PresignedUploadOptions, LAZY_HEAD_BYTES};
#[cfg(feature = "file")]
pub use crate::metadata::{Metadata, MetadataHint};
#[cfg(feature = "file")]
pub use crate::source::FileSource;

/// The crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    /// package.json is the single source of truth for the version across all five
    /// ports; `scripts/sync-versions.mjs` copies it here. Asserting against a
    /// hardcoded literal instead is how this crate sat at "1.1.5" while the repo
    /// shipped 2.2.12 — the test pinned the drift in place rather than catching it.
    #[test]
    fn version_matches_package_json() {
        let manifest =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
        let raw = std::fs::read_to_string(&manifest)
            .unwrap_or_else(|e| panic!("read {}: {e}", manifest.display()));
        let expected = raw
            .split("\"version\":")
            .nth(1)
            .and_then(|rest| rest.split('"').nth(1))
            .expect("package.json has no \"version\" field");

        assert_eq!(
            VERSION, expected,
            "run `pnpm version:sync` and commit the result"
        );
    }
}
