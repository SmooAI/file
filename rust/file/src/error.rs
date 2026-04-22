//! Error types for the smooai-file library.

use std::fmt;

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

    /// A file failed validation (size, mime, or content-vs-claim check).
    #[error(transparent)]
    Validation(#[from] FileValidationError),
}

/// Convenience type alias for Results using FileError.
pub type Result<T> = std::result::Result<T, FileError>;

/// Errors raised by [`crate::File::validate`] when a file fails size, mime,
/// or content-vs-claim checks.
///
/// Mirrors the TypeScript `FileValidationError` hierarchy, but collapsed into
/// a single enum per Rust idioms. Callers in HTTP routes typically map any
/// variant to a 400 Bad Request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileValidationError {
    /// File size exceeded (or could not be determined to be within) the
    /// declared maximum.
    ///
    /// `actual` is `None` when the file source did not expose a size.
    SizeExceeded {
        /// Actual size in bytes, or `None` when unknown.
        actual: Option<u64>,
        /// Maximum allowed size in bytes.
        max: u64,
    },

    /// The file's mime type is not in the allowlist.
    ///
    /// `actual` is `None` when the file source did not expose a mime type.
    MimeNotAllowed {
        /// Detected/hinted mime type, or `None` when unknown.
        actual: Option<String>,
        /// The allowlist that was checked against.
        allowed: Vec<String>,
    },

    /// Magic-byte detection disagrees with the caller-claimed mime type.
    ///
    /// This is the primary defense against mime-spoofing attacks — e.g. a
    /// `.php` file uploaded with `Content-Type: image/png`.
    ContentMismatch {
        /// Mime type claimed by the caller (e.g. the browser-sent `Content-Type`).
        claimed: Option<String>,
        /// Mime type detected from the file's magic bytes.
        detected: Option<String>,
    },
}

impl fmt::Display for FileValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FileValidationError::SizeExceeded { actual, max } => match actual {
                Some(a) => write!(
                    f,
                    "File size ({} bytes) exceeds maximum allowed ({} bytes)",
                    a, max
                ),
                None => write!(f, "File size is unknown; maxSize is {} bytes", max),
            },
            FileValidationError::MimeNotAllowed { actual, allowed } => {
                let joined = allowed.join(", ");
                match actual {
                    Some(m) => write!(
                        f,
                        "File mime type \"{}\" is not in the allowed list: {}",
                        m, joined
                    ),
                    None => write!(
                        f,
                        "File mime type is unknown; allowed types are: {}",
                        joined
                    ),
                }
            }
            FileValidationError::ContentMismatch { claimed, detected } => write!(
                f,
                "File content does not match claimed mime type. Claimed: {}, detected: {}",
                claimed.as_deref().unwrap_or("unknown"),
                detected.as_deref().unwrap_or("unknown")
            ),
        }
    }
}

impl std::error::Error for FileValidationError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_size_exceeded_message_with_actual() {
        let err = FileValidationError::SizeExceeded {
            actual: Some(100),
            max: 50,
        };
        let msg = err.to_string();
        assert!(msg.contains("100 bytes"));
        assert!(msg.contains("50 bytes"));
    }

    #[test]
    fn test_size_exceeded_message_without_actual() {
        let err = FileValidationError::SizeExceeded {
            actual: None,
            max: 50,
        };
        let msg = err.to_string();
        assert!(msg.contains("unknown"));
        assert!(msg.contains("50"));
    }

    #[test]
    fn test_mime_not_allowed_message() {
        let err = FileValidationError::MimeNotAllowed {
            actual: Some("text/plain".to_string()),
            allowed: vec!["image/png".to_string(), "image/jpeg".to_string()],
        };
        let msg = err.to_string();
        assert!(msg.contains("text/plain"));
        assert!(msg.contains("image/png"));
        assert!(msg.contains("image/jpeg"));
    }

    #[test]
    fn test_content_mismatch_message() {
        let err = FileValidationError::ContentMismatch {
            claimed: Some("application/pdf".to_string()),
            detected: Some("image/png".to_string()),
        };
        let msg = err.to_string();
        assert!(msg.contains("application/pdf"));
        assert!(msg.contains("image/png"));
    }

    #[test]
    fn test_validation_error_converts_to_file_error() {
        let v = FileValidationError::SizeExceeded {
            actual: Some(10),
            max: 5,
        };
        let fe: FileError = v.into();
        assert!(matches!(fe, FileError::Validation(_)));
    }
}
