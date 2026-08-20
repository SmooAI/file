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
//! # Examples
//!
//! ```no_run
//! # use smooai_file::File;
//! # use bytes::Bytes;
//! # async fn example() -> smooai_file::error::Result<()> {
//! let file = File::from_bytes(Bytes::from("hello world"), None).await?;
//! let text = file.read_text().await?;
//! assert_eq!(text, "hello world");
//! # Ok(())
//! # }
//! ```

pub mod content_disposition;
pub mod detection;
pub mod error;
pub mod file;
pub mod metadata;
pub mod source;

// Re-export primary types at the crate root for convenience.
pub use crate::error::{FileError, FileValidationError};
pub use crate::file::{File, PresignedUploadOptions, LAZY_HEAD_BYTES};
pub use crate::metadata::{Metadata, MetadataHint};
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
