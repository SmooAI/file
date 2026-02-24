//! The core `File` struct and its operations.
//!
//! Provides a unified interface for creating, reading, writing, and manipulating
//! files from different sources: URLs, local filesystem, bytes, streams, and S3.

use std::path::Path;

use aws_config::BehaviorVersion;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client as S3Client;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures::StreamExt;
use sha2::{Digest, Sha256};
use tracing;

use crate::content_disposition::parse_content_disposition;
use crate::detection::{
    detect_from_bytes, detect_from_filename, extension_from_mime, mime_from_extension,
};
use crate::error::{FileError, Result};
use crate::metadata::{Metadata, MetadataHint};
use crate::source::FileSource;

/// A unified file type that can represent files from URLs, local filesystem,
/// raw bytes, async streams, and Amazon S3.
///
/// # Examples
///
/// ```no_run
/// # use smooai_file::File;
/// # async fn example() -> smooai_file::error::Result<()> {
/// // From bytes
/// let file = File::from_bytes(b"hello world".to_vec().into(), None).await?;
/// let text = file.read_text().await?;
/// assert_eq!(text, "hello world");
///
/// // From local file
/// let file = File::from_file("/path/to/file.txt", None).await?;
/// println!("Size: {:?}", file.size());
/// # Ok(())
/// # }
/// ```
pub struct File {
    source: FileSource,
    data: Bytes,
    metadata: Metadata,
}

impl File {
    // -----------------------------------------------------------------------
    // Constructors
    // -----------------------------------------------------------------------

    /// Create a `File` from raw bytes.
    pub async fn from_bytes(data: Bytes, hint: Option<MetadataHint>) -> Result<Self> {
        let mut metadata = Metadata::new();

        // Apply hints first
        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        // Set size from actual data
        metadata.size = Some(data.len() as u64);

        // Detect from bytes
        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if metadata.mime_type.is_none() {
            metadata.mime_type = detection.mime_type;
        }
        if metadata.extension.is_none() {
            metadata.extension = detection.extension;
        }

        // Fallback: extension from mime
        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        // Fallback: mime from name
        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                metadata.mime_type = det.mime_type;
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }

        tracing::info!(?metadata, "File created from bytes");

        Ok(Self {
            source: FileSource::Bytes,
            data,
            metadata,
        })
    }

    /// Create a `File` from a local filesystem path.
    pub async fn from_file<P: AsRef<Path>>(path: P, hint: Option<MetadataHint>) -> Result<Self> {
        let path = path.as_ref();
        let path_str = path.to_string_lossy().to_string();

        let data = tokio::fs::read(path).await?;
        let data = Bytes::from(data);

        let fs_meta = tokio::fs::metadata(path).await?;

        let mut metadata = Metadata::new();

        // Apply hints
        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        // Set path and name from filesystem
        metadata.path = Some(path_str);
        if metadata.name.is_none() {
            metadata.name = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string());
        }

        // Filesystem metadata
        metadata.size = Some(fs_meta.len());
        if let Ok(modified) = fs_meta.modified() {
            metadata.last_modified = Some(DateTime::<Utc>::from(modified));
        }
        if let Ok(created) = fs_meta.created() {
            metadata.created_at = Some(DateTime::<Utc>::from(created));
        }

        // Detect type from magic bytes first
        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if detection.mime_type.is_some() {
            metadata.mime_type = detection.mime_type;
        }
        if detection.extension.is_some() {
            metadata.extension = detection.extension;
        }

        // Fallback: mime_guess from filename
        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                if metadata.mime_type.is_none() {
                    metadata.mime_type = det.mime_type;
                }
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }

        // Fallback: extension from mime
        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        tracing::info!(?metadata, "File created from filesystem");

        Ok(Self {
            source: FileSource::File,
            data,
            metadata,
        })
    }

    /// Create a `File` from an HTTP/HTTPS URL.
    pub async fn from_url(url: &str, hint: Option<MetadataHint>) -> Result<Self> {
        let response = reqwest::get(url).await?;

        let mut metadata = Metadata::new();
        metadata.url = Some(url.to_string());

        // Apply hints
        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        // Parse response headers
        let headers = response.headers().clone();

        // Content-Disposition filename
        if let Some(cd_header) = headers.get("content-disposition") {
            if let Ok(cd_str) = cd_header.to_str() {
                if let Some(cd) = parse_content_disposition(cd_str) {
                    if let Some(fname) = cd.filename {
                        metadata.name = Some(fname);
                    }
                }
            }
        }

        // Fallback: name from URL path
        if metadata.name.is_none() {
            metadata.name = get_filename_from_url(url);
        }

        // Content-Type
        if let Some(ct) = headers.get("content-type") {
            if let Ok(ct_str) = ct.to_str() {
                // Take only the mime part, not charset etc.
                let mime_part = ct_str.split(';').next().unwrap_or(ct_str).trim();
                metadata.mime_type = Some(mime_part.to_string());
            }
        }

        // Content-Length
        if let Some(cl) = headers.get("content-length") {
            if let Ok(cl_str) = cl.to_str() {
                if let Ok(size) = cl_str.parse::<u64>() {
                    metadata.size = Some(size);
                }
            }
        }

        // ETag / Content-MD5
        if let Some(etag) = headers.get("etag") {
            if let Ok(etag_str) = etag.to_str() {
                metadata.hash = Some(etag_str.trim_matches('"').to_string());
            }
        } else if let Some(md5) = headers.get("content-md5") {
            if let Ok(md5_str) = md5.to_str() {
                metadata.hash = Some(md5_str.to_string());
            }
        }

        // Last-Modified
        if let Some(lm) = headers.get("last-modified") {
            if let Ok(lm_str) = lm.to_str() {
                if let Ok(dt) = DateTime::parse_from_rfc2822(lm_str) {
                    metadata.last_modified = Some(dt.with_timezone(&Utc));
                } else if let Ok(dt) = DateTime::parse_from_rfc3339(lm_str) {
                    metadata.last_modified = Some(dt.with_timezone(&Utc));
                }
            }
        }

        // Read the body
        let data = Bytes::from(response.bytes().await?);

        // Override size from actual data if not set from headers
        if metadata.size.is_none() {
            metadata.size = Some(data.len() as u64);
        }

        // Detect from bytes (may override mime from response if magic bytes are definitive)
        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if let Some(det_mime) = &detection.mime_type {
            // Only use magic-byte detection if it's more specific than generic content-type
            if metadata.mime_type.as_deref() == Some("application/octet-stream")
                || metadata.mime_type.is_none()
            {
                metadata.mime_type = Some(det_mime.clone());
            }
        }
        if metadata.extension.is_none() {
            metadata.extension = detection.extension;
        }

        // Fallback: mime_guess from name
        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                metadata.mime_type = det.mime_type;
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }

        // Fallback: extension from mime
        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        // Fallback: mime from extension
        if metadata.mime_type.is_none() {
            if let Some(ext) = &metadata.extension {
                metadata.mime_type = mime_from_extension(ext);
            }
        }

        tracing::info!(?metadata, "File created from URL");

        Ok(Self {
            source: FileSource::Url,
            data,
            metadata,
        })
    }

    /// Create a `File` from an async byte stream.
    ///
    /// The stream is fully consumed and buffered into memory.
    pub async fn from_stream<S>(stream: S, hint: Option<MetadataHint>) -> Result<Self>
    where
        S: futures::Stream<Item = std::result::Result<Bytes, std::io::Error>> + Unpin,
    {
        let mut buf = Vec::new();
        tokio::pin!(stream);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buf.extend_from_slice(&chunk);
        }

        let data = Bytes::from(buf);
        let mut metadata = Metadata::new();

        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        metadata.size = Some(data.len() as u64);

        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if metadata.mime_type.is_none() {
            metadata.mime_type = detection.mime_type;
        }
        if metadata.extension.is_none() {
            metadata.extension = detection.extension;
        }

        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                metadata.mime_type = det.mime_type;
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }

        tracing::info!(?metadata, "File created from stream");

        Ok(Self {
            source: FileSource::Stream,
            data,
            metadata,
        })
    }

    /// Create a `File` from an S3 bucket and key.
    pub async fn from_s3(bucket: &str, key: &str, hint: Option<MetadataHint>) -> Result<Self> {
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
        let client = S3Client::new(&config);

        let resp = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| FileError::S3(e.to_string()))?;

        let mut metadata = Metadata::new();
        metadata.url = Some(format!("s3://{}/{}", bucket, key));

        // Name from key
        metadata.name = Path::new(key)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string());

        // Apply hints
        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        // S3 response metadata
        if let Some(ct) = resp.content_type() {
            metadata.mime_type = Some(ct.to_string());
        }
        if let Some(cl) = resp.content_length() {
            if cl > 0 {
                metadata.size = Some(cl as u64);
            }
        }
        if let Some(etag) = resp.e_tag() {
            metadata.hash = Some(etag.trim_matches('"').to_string());
        }
        if let Some(lm) = resp.last_modified() {
            // AWS SDK returns smithy DateTime
            let epoch_secs = lm.secs();
            let subsec_nanos = lm.subsec_nanos();
            if let Some(dt) = DateTime::from_timestamp(epoch_secs, subsec_nanos) {
                metadata.last_modified = Some(dt);
            }
        }

        // Content-Disposition
        if let Some(cd_str) = resp.content_disposition() {
            if let Some(cd) = parse_content_disposition(cd_str) {
                if let Some(fname) = cd.filename {
                    metadata.name = Some(fname);
                }
            }
        }

        // Read body
        let body_bytes = resp
            .body
            .collect()
            .await
            .map_err(|e| FileError::S3(format!("Failed to read S3 body: {}", e)))?
            .into_bytes();
        let data = Bytes::from(body_bytes.to_vec());

        if metadata.size.is_none() {
            metadata.size = Some(data.len() as u64);
        }

        // Detect from bytes
        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if metadata.extension.is_none() {
            metadata.extension = detection.extension;
        }
        // Only override mime if S3 didn't provide one
        if metadata.mime_type.is_none() {
            metadata.mime_type = detection.mime_type;
        }

        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                metadata.mime_type = det.mime_type;
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }

        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        tracing::info!(?metadata, "File created from S3");

        Ok(Self {
            source: FileSource::S3,
            data,
            metadata,
        })
    }

    /// Create a `File` from an S3 bucket and key using a provided S3 client.
    /// Useful for testing or when you already have a configured client.
    pub async fn from_s3_with_client(
        client: &S3Client,
        bucket: &str,
        key: &str,
        hint: Option<MetadataHint>,
    ) -> Result<Self> {
        let resp = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| FileError::S3(e.to_string()))?;

        let mut metadata = Metadata::new();
        metadata.url = Some(format!("s3://{}/{}", bucket, key));

        metadata.name = Path::new(key)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string());

        if let Some(h) = &hint {
            metadata.merge_hints(h);
        }

        if let Some(ct) = resp.content_type() {
            metadata.mime_type = Some(ct.to_string());
        }
        if let Some(cl) = resp.content_length() {
            if cl > 0 {
                metadata.size = Some(cl as u64);
            }
        }
        if let Some(etag) = resp.e_tag() {
            metadata.hash = Some(etag.trim_matches('"').to_string());
        }
        if let Some(lm) = resp.last_modified() {
            let epoch_secs = lm.secs();
            let subsec_nanos = lm.subsec_nanos();
            if let Some(dt) = DateTime::from_timestamp(epoch_secs, subsec_nanos) {
                metadata.last_modified = Some(dt);
            }
        }
        if let Some(cd_str) = resp.content_disposition() {
            if let Some(cd) = parse_content_disposition(cd_str) {
                if let Some(fname) = cd.filename {
                    metadata.name = Some(fname);
                }
            }
        }

        let body_bytes = resp
            .body
            .collect()
            .await
            .map_err(|e| FileError::S3(format!("Failed to read S3 body: {}", e)))?
            .into_bytes();
        let data = Bytes::from(body_bytes.to_vec());

        if metadata.size.is_none() {
            metadata.size = Some(data.len() as u64);
        }

        let detection = detect_from_bytes(&data, metadata.name.as_deref());
        if metadata.extension.is_none() {
            metadata.extension = detection.extension;
        }
        if metadata.mime_type.is_none() {
            metadata.mime_type = detection.mime_type;
        }
        if metadata.mime_type.is_none() {
            if let Some(name) = &metadata.name {
                let det = detect_from_filename(name);
                metadata.mime_type = det.mime_type;
                if metadata.extension.is_none() {
                    metadata.extension = det.extension;
                }
            }
        }
        if metadata.extension.is_none() {
            if let Some(mime) = &metadata.mime_type {
                metadata.extension = extension_from_mime(mime);
            }
        }

        Ok(Self {
            source: FileSource::S3,
            data,
            metadata,
        })
    }

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    /// Returns the file source type.
    pub fn source(&self) -> FileSource {
        self.source
    }

    /// Returns a reference to the full metadata.
    pub fn metadata(&self) -> &Metadata {
        &self.metadata
    }

    /// Returns the file name, if known.
    pub fn name(&self) -> Option<&str> {
        self.metadata.name.as_deref()
    }

    /// Returns the MIME type, if known.
    pub fn mime_type(&self) -> Option<&str> {
        self.metadata.mime_type.as_deref()
    }

    /// Returns the file size in bytes, if known.
    pub fn size(&self) -> Option<u64> {
        self.metadata.size
    }

    /// Returns the file extension (without dot), if known.
    pub fn extension(&self) -> Option<&str> {
        self.metadata.extension.as_deref()
    }

    /// Returns the URL the file was loaded from, if applicable.
    pub fn url(&self) -> Option<&str> {
        self.metadata.url.as_deref()
    }

    /// Returns the filesystem path, if applicable.
    pub fn path(&self) -> Option<&str> {
        self.metadata.path.as_deref()
    }

    /// Returns the hash/etag, if known.
    pub fn hash(&self) -> Option<&str> {
        self.metadata.hash.as_deref()
    }

    /// Returns when the file was last modified, if known.
    pub fn last_modified(&self) -> Option<DateTime<Utc>> {
        self.metadata.last_modified
    }

    /// Returns when the file was created, if known.
    pub fn created_at(&self) -> Option<DateTime<Utc>> {
        self.metadata.created_at
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /// Read the file contents as raw bytes.
    pub async fn read(&self) -> Result<Bytes> {
        Ok(self.data.clone())
    }

    /// Read the file contents as a UTF-8 string.
    pub async fn read_text(&self) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.data).to_string())
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /// Save the file to a local filesystem path.
    ///
    /// Returns a tuple of the original file and a new file representing the saved copy.
    pub async fn save(&self, destination: &str) -> Result<(File, File)> {
        tokio::fs::write(destination, &self.data).await?;
        let new_file = File::from_file(destination, None).await?;
        // Clone self for the "original" return
        let original = File {
            source: self.source,
            data: self.data.clone(),
            metadata: self.metadata.clone(),
        };
        Ok((original, new_file))
    }

    /// Move the file to a new location on the filesystem.
    ///
    /// If the file was originally from the filesystem, the source file is deleted.
    pub async fn move_to(&self, destination: &str) -> Result<File> {
        tokio::fs::write(destination, &self.data).await?;

        // Delete original if it was a filesystem file
        if self.source == FileSource::File {
            if let Some(path) = &self.metadata.path {
                tokio::fs::remove_file(path).await?;
            }
        }

        File::from_file(destination, None).await
    }

    /// Delete the file from the filesystem.
    ///
    /// Only works for files with source `FileSource::File`.
    pub async fn delete(&self) -> Result<()> {
        if self.source == FileSource::File {
            if let Some(path) = &self.metadata.path {
                tokio::fs::remove_file(path).await?;
            }
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Checksum
    // -----------------------------------------------------------------------

    /// Calculate the SHA-256 checksum of the file contents.
    pub async fn checksum(&self) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(&self.data);
        Ok(hex::encode(hasher.finalize()))
    }

    // -----------------------------------------------------------------------
    // S3 operations
    // -----------------------------------------------------------------------

    /// Upload the file to an S3 bucket.
    pub async fn upload_to_s3(&self, bucket: &str, key: &str) -> Result<()> {
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
        let client = S3Client::new(&config);
        self.upload_to_s3_with_client(&client, bucket, key).await
    }

    /// Upload the file to an S3 bucket using a provided client.
    pub async fn upload_to_s3_with_client(
        &self,
        client: &S3Client,
        bucket: &str,
        key: &str,
    ) -> Result<()> {
        let mut req = client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(self.data.clone().into());

        if let Some(mime) = &self.metadata.mime_type {
            req = req.content_type(mime.clone());
        }
        if let Some(size) = self.metadata.size {
            req = req.content_length(size as i64);
        }
        if let Some(name) = &self.metadata.name {
            req = req.content_disposition(format!("attachment; filename=\"{}\"", name));
        }

        req.send().await.map_err(|e| FileError::S3(e.to_string()))?;

        Ok(())
    }

    /// Download a file from S3 (alias for `from_s3`).
    pub async fn download_from_s3(bucket: &str, key: &str) -> Result<Self> {
        Self::from_s3(bucket, key, None).await
    }

    /// Download a file from S3 using a provided client.
    pub async fn download_from_s3_with_client(
        client: &S3Client,
        bucket: &str,
        key: &str,
    ) -> Result<Self> {
        Self::from_s3_with_client(client, bucket, key, None).await
    }

    /// Generate a presigned URL for accessing an S3 object.
    ///
    /// Only works for files with source `FileSource::S3`.
    pub async fn get_signed_url(&self, expires_in_secs: u64) -> Result<String> {
        if self.source != FileSource::S3 {
            return Err(FileError::InvalidSource(
                "Cannot generate signed URL for non-S3 file".to_string(),
            ));
        }

        let s3_url = self.metadata.url.as_deref().ok_or_else(|| {
            FileError::InvalidSource("S3 file is missing URL metadata".to_string())
        })?;

        let (bucket, key) = parse_s3_url(s3_url)?;

        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
        let client = S3Client::new(&config);

        self.get_signed_url_with_client(&client, &bucket, &key, expires_in_secs)
            .await
    }

    /// Generate a presigned URL using a provided S3 client.
    pub async fn get_signed_url_with_client(
        &self,
        client: &S3Client,
        bucket: &str,
        key: &str,
        expires_in_secs: u64,
    ) -> Result<String> {
        if self.source != FileSource::S3 {
            return Err(FileError::InvalidSource(
                "Cannot generate signed URL for non-S3 file".to_string(),
            ));
        }

        let presigning =
            PresigningConfig::expires_in(std::time::Duration::from_secs(expires_in_secs))
                .map_err(|e| FileError::S3(format!("Presigning config error: {}", e)))?;

        let presigned = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .presigned(presigning)
            .await
            .map_err(|e| FileError::S3(format!("Presigning error: {}", e)))?;

        Ok(presigned.uri().to_string())
    }

    // -----------------------------------------------------------------------
    // Metadata mutation
    // -----------------------------------------------------------------------

    /// Update the file's metadata with partial values.
    pub fn set_metadata(&mut self, updates: MetadataHint) {
        if updates.name.is_some() {
            self.metadata.name = updates.name;
        }
        if updates.mime_type.is_some() {
            self.metadata.mime_type = updates.mime_type;
        }
        if updates.size.is_some() {
            self.metadata.size = updates.size;
        }
        if updates.extension.is_some() {
            self.metadata.extension = updates.extension;
        }
        if updates.url.is_some() {
            self.metadata.url = updates.url;
        }
        if updates.path.is_some() {
            self.metadata.path = updates.path;
        }
        if updates.hash.is_some() {
            self.metadata.hash = updates.hash;
        }
        if updates.last_modified.is_some() {
            self.metadata.last_modified = updates.last_modified;
        }
        if updates.created_at.is_some() {
            self.metadata.created_at = updates.created_at;
        }
    }

    /// Returns a JSON string representation of the file metadata and source.
    pub fn to_string_pretty(&self) -> String {
        #[derive(serde::Serialize)]
        struct FileRepr<'a> {
            source: &'a FileSource,
            #[serde(flatten)]
            metadata: &'a Metadata,
        }
        let repr = FileRepr {
            source: &self.source,
            metadata: &self.metadata,
        };
        serde_json::to_string(&repr).unwrap_or_default()
    }
}

impl std::fmt::Display for File {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_string_pretty())
    }
}

impl std::fmt::Debug for File {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("File")
            .field("source", &self.source)
            .field("metadata", &self.metadata)
            .field("data_len", &self.data.len())
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract a filename from a URL path.
fn get_filename_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let path = parsed.path();
    let filename = Path::new(path).file_name()?.to_str()?;
    if filename.is_empty() || filename == "/" {
        None
    } else {
        Some(filename.to_string())
    }
}

/// Parse an `s3://bucket/key` URL into (bucket, key).
fn parse_s3_url(url: &str) -> Result<(String, String)> {
    let without_scheme = url
        .strip_prefix("s3://")
        .ok_or_else(|| FileError::InvalidSource(format!("Invalid S3 URL: {}", url)))?;

    let slash_pos = without_scheme
        .find('/')
        .ok_or_else(|| FileError::InvalidSource(format!("Invalid S3 URL (no key): {}", url)))?;

    let bucket = without_scheme[..slash_pos].to_string();
    let key = without_scheme[slash_pos + 1..].to_string();

    if bucket.is_empty() || key.is_empty() {
        return Err(FileError::InvalidSource(format!(
            "Invalid S3 URL (empty bucket or key): {}",
            url
        )));
    }

    Ok((bucket, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_filename_from_url() {
        assert_eq!(
            get_filename_from_url("https://example.com/path/to/file.txt"),
            Some("file.txt".to_string())
        );
        assert_eq!(get_filename_from_url("https://example.com/"), None);
        assert_eq!(
            get_filename_from_url("https://example.com/image.png?v=1"),
            Some("image.png".to_string())
        );
    }

    #[test]
    fn test_parse_s3_url() {
        let (bucket, key) = parse_s3_url("s3://my-bucket/path/to/file.txt").unwrap();
        assert_eq!(bucket, "my-bucket");
        assert_eq!(key, "path/to/file.txt");
    }

    #[test]
    fn test_parse_s3_url_invalid() {
        assert!(parse_s3_url("https://example.com").is_err());
        assert!(parse_s3_url("s3://").is_err());
        assert!(parse_s3_url("s3:///key").is_err());
    }

    #[tokio::test]
    async fn test_from_bytes_basic() {
        let data = Bytes::from("hello world");
        let file = File::from_bytes(data, None).await.unwrap();
        assert_eq!(file.source(), FileSource::Bytes);
        assert_eq!(file.size(), Some(11));
        assert!(file.path().is_none());
        assert!(file.url().is_none());
    }

    #[tokio::test]
    async fn test_from_bytes_with_hint() {
        let data = Bytes::from("hello world");
        let hint = Metadata {
            name: Some("greeting.txt".to_string()),
            mime_type: Some("text/plain".to_string()),
            ..Default::default()
        };
        let file = File::from_bytes(data, Some(hint)).await.unwrap();
        assert_eq!(file.name(), Some("greeting.txt"));
        assert_eq!(file.mime_type(), Some("text/plain"));
        assert_eq!(file.size(), Some(11));
    }

    #[tokio::test]
    async fn test_from_bytes_png_detection() {
        // PNG header
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend_from_slice(&[0; 100]);
        let data = Bytes::from(png);
        let file = File::from_bytes(data, None).await.unwrap();
        assert_eq!(file.mime_type(), Some("image/png"));
        assert_eq!(file.extension(), Some("png"));
    }

    #[tokio::test]
    async fn test_read_and_read_text() {
        let data = Bytes::from("hello world");
        let file = File::from_bytes(data.clone(), None).await.unwrap();

        let bytes = file.read().await.unwrap();
        assert_eq!(bytes, data);

        let text = file.read_text().await.unwrap();
        assert_eq!(text, "hello world");
    }

    #[tokio::test]
    async fn test_checksum() {
        let data = Bytes::from(vec![0u8; 8]);
        let file = File::from_bytes(data, None).await.unwrap();
        let checksum = file.checksum().await.unwrap();
        assert_eq!(checksum.len(), 64); // SHA-256 hex is 64 chars
                                        // Known SHA-256 of 8 zero bytes
        assert_eq!(
            checksum,
            "af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc"
        );
    }

    #[tokio::test]
    async fn test_set_metadata() {
        let data = Bytes::from("test");
        let mut file = File::from_bytes(data, None).await.unwrap();
        file.set_metadata(Metadata {
            name: Some("new-name.txt".to_string()),
            mime_type: Some("text/plain".to_string()),
            ..Default::default()
        });
        assert_eq!(file.name(), Some("new-name.txt"));
        assert_eq!(file.mime_type(), Some("text/plain"));
    }

    #[tokio::test]
    async fn test_display() {
        let data = Bytes::from("test");
        let hint = Metadata {
            name: Some("test.txt".to_string()),
            ..Default::default()
        };
        let file = File::from_bytes(data, Some(hint)).await.unwrap();
        let display = file.to_string();
        assert!(display.contains("Bytes"));
        assert!(display.contains("test.txt"));
    }

    #[tokio::test]
    async fn test_from_stream() {
        let chunks = vec![Ok(Bytes::from("hello ")), Ok(Bytes::from("world"))];
        let stream = futures::stream::iter(chunks);
        let file = File::from_stream(stream, None).await.unwrap();
        assert_eq!(file.source(), FileSource::Stream);
        let text = file.read_text().await.unwrap();
        assert_eq!(text, "hello world");
        assert_eq!(file.size(), Some(11));
    }
}
