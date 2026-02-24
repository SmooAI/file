//! Error types for the smooai-file library.

use thiserror::Error;

/// Errors that can occur during file operations.
#[derive(Error, Debug)]
pub enum FileError {
    /// An I/O error occurred while reading or writing a file.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// An HTTP error occurred while fetching a file from a URL.
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// An S3 error occurred during an AWS S3 operation.
    #[error("S3 error: {0}")]
    S3(String),

    /// The provided file source is invalid or unsupported for the requested operation.
    #[error("Invalid source: {0}")]
    InvalidSource(String),
}

/// Convenience type alias for Results using FileError.
pub type Result<T> = std::result::Result<T, FileError>;
