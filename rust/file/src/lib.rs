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
pub use crate::error::FileError;
pub use crate::file::File;
pub use crate::metadata::{Metadata, MetadataHint};
pub use crate::source::FileSource;

/// The crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(VERSION, "1.1.5");
    }
}
