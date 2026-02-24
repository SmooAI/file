//! File source enumeration.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Represents the origin of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FileSource {
    /// File loaded from an HTTP/HTTPS URL.
    Url,
    /// File created from raw bytes in memory.
    Bytes,
    /// File loaded from the local filesystem.
    File,
    /// File created from an async byte stream.
    Stream,
    /// File loaded from Amazon S3.
    S3,
}

impl fmt::Display for FileSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FileSource::Url => write!(f, "Url"),
            FileSource::Bytes => write!(f, "Bytes"),
            FileSource::File => write!(f, "File"),
            FileSource::Stream => write!(f, "Stream"),
            FileSource::S3 => write!(f, "S3"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display() {
        assert_eq!(FileSource::Url.to_string(), "Url");
        assert_eq!(FileSource::Bytes.to_string(), "Bytes");
        assert_eq!(FileSource::File.to_string(), "File");
        assert_eq!(FileSource::Stream.to_string(), "Stream");
        assert_eq!(FileSource::S3.to_string(), "S3");
    }

    #[test]
    fn test_serialize() {
        let json = serde_json::to_string(&FileSource::Url).unwrap();
        assert_eq!(json, "\"Url\"");
    }

    #[test]
    fn test_deserialize() {
        let source: FileSource = serde_json::from_str("\"S3\"").unwrap();
        assert_eq!(source, FileSource::S3);
    }

    #[test]
    fn test_equality() {
        assert_eq!(FileSource::File, FileSource::File);
        assert_ne!(FileSource::File, FileSource::S3);
    }
}
