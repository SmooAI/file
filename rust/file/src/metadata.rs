//! File metadata types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents metadata about a file including its properties and attributes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metadata {
    /// The file name (e.g., "example.txt").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The MIME type (e.g., "text/plain").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,

    /// The file size in bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,

    /// The file extension without the dot (e.g., "txt").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,

    /// The URL the file was loaded from (HTTP URL or s3:// URI).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// The local filesystem path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,

    /// A hash/etag associated with the file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,

    /// When the file was last modified.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<DateTime<Utc>>,

    /// When the file was created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
}

impl Metadata {
    /// Creates a new empty Metadata.
    pub fn new() -> Self {
        Self::default()
    }

    /// Merges another metadata (hints) into this one. Values from `other`
    /// only fill in fields that are currently `None` in `self`.
    pub fn merge_hints(&mut self, other: &MetadataHint) {
        if self.name.is_none() {
            self.name.clone_from(&other.name);
        }
        if self.mime_type.is_none() {
            self.mime_type.clone_from(&other.mime_type);
        }
        if self.size.is_none() {
            self.size = other.size;
        }
        if self.extension.is_none() {
            self.extension.clone_from(&other.extension);
        }
        if self.url.is_none() {
            self.url.clone_from(&other.url);
        }
        if self.path.is_none() {
            self.path.clone_from(&other.path);
        }
        if self.hash.is_none() {
            self.hash.clone_from(&other.hash);
        }
        if self.last_modified.is_none() {
            self.last_modified = other.last_modified;
        }
        if self.created_at.is_none() {
            self.created_at = other.created_at;
        }
    }
}

/// A partial set of metadata properties used as hints when creating a file.
/// All fields are optional and mirror those in [`Metadata`].
pub type MetadataHint = Metadata;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_metadata() {
        let m = Metadata::new();
        assert!(m.name.is_none());
        assert!(m.mime_type.is_none());
        assert!(m.size.is_none());
        assert!(m.extension.is_none());
        assert!(m.url.is_none());
        assert!(m.path.is_none());
        assert!(m.hash.is_none());
        assert!(m.last_modified.is_none());
        assert!(m.created_at.is_none());
    }

    #[test]
    fn test_merge_hints_fills_none() {
        let mut m = Metadata::new();
        let hint = Metadata {
            name: Some("test.txt".to_string()),
            mime_type: Some("text/plain".to_string()),
            size: Some(100),
            ..Default::default()
        };
        m.merge_hints(&hint);
        assert_eq!(m.name.as_deref(), Some("test.txt"));
        assert_eq!(m.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(m.size, Some(100));
    }

    #[test]
    fn test_merge_hints_does_not_overwrite() {
        let mut m = Metadata {
            name: Some("original.txt".to_string()),
            ..Default::default()
        };
        let hint = Metadata {
            name: Some("overwritten.txt".to_string()),
            ..Default::default()
        };
        m.merge_hints(&hint);
        assert_eq!(m.name.as_deref(), Some("original.txt"));
    }

    #[test]
    fn test_serialize() {
        let m = Metadata {
            name: Some("test.txt".to_string()),
            size: Some(42),
            ..Default::default()
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"name\":\"test.txt\""));
        assert!(json.contains("\"size\":42"));
        // None fields should be skipped
        assert!(!json.contains("\"url\""));
    }

    #[test]
    fn test_deserialize() {
        let json = r#"{"name":"test.txt","mime_type":"text/plain","size":100}"#;
        let m: Metadata = serde_json::from_str(json).unwrap();
        assert_eq!(m.name.as_deref(), Some("test.txt"));
        assert_eq!(m.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(m.size, Some(100));
        assert!(m.extension.is_none());
    }
}
