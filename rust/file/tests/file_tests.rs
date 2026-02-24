//! Integration tests for the File struct.

use bytes::Bytes;
use smooai_file::{File, FileSource, Metadata};
use std::io::Write;
use tempfile::NamedTempFile;

#[tokio::test]
async fn test_from_bytes_empty() {
    let file = File::from_bytes(Bytes::new(), None).await.unwrap();
    assert_eq!(file.source(), FileSource::Bytes);
    assert_eq!(file.size(), Some(0));
    let text = file.read_text().await.unwrap();
    assert_eq!(text, "");
}

#[tokio::test]
async fn test_from_bytes_text() {
    let content = "Hello, SmooAI!";
    let file = File::from_bytes(Bytes::from(content), None).await.unwrap();
    assert_eq!(file.source(), FileSource::Bytes);
    assert_eq!(file.size(), Some(content.len() as u64));

    let text = file.read_text().await.unwrap();
    assert_eq!(text, content);
}

#[tokio::test]
async fn test_from_bytes_with_name_hint() {
    let hint = Metadata {
        name: Some("report.pdf".to_string()),
        ..Default::default()
    };
    let data = Bytes::from(vec![0u8; 32]);
    let file = File::from_bytes(data, Some(hint)).await.unwrap();
    assert_eq!(file.name(), Some("report.pdf"));
    // mime_guess should fill in the mime from the .pdf extension
    assert_eq!(file.mime_type(), Some("application/pdf"));
    assert_eq!(file.extension(), Some("pdf"));
}

#[tokio::test]
async fn test_from_bytes_png_detection() {
    let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[0; 100]);
    let file = File::from_bytes(Bytes::from(png), None).await.unwrap();
    assert_eq!(file.mime_type(), Some("image/png"));
    assert_eq!(file.extension(), Some("png"));
}

#[tokio::test]
async fn test_from_file_text() {
    let mut tmp = NamedTempFile::new().unwrap();
    let content = "file content here";
    write!(tmp, "{}", content).unwrap();
    tmp.flush().unwrap();

    let file = File::from_file(tmp.path(), None).await.unwrap();
    assert_eq!(file.source(), FileSource::File);
    assert_eq!(file.size(), Some(content.len() as u64));

    let text = file.read_text().await.unwrap();
    assert_eq!(text, content);

    // Path should be set
    assert!(file.path().is_some());

    // Name should be the temp file name
    assert!(file.name().is_some());

    // Filesystem metadata
    assert!(file.last_modified().is_some());
    assert!(file.created_at().is_some());
}

#[tokio::test]
async fn test_from_file_binary() {
    let mut tmp = NamedTempFile::with_suffix(".png").unwrap();
    let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[0; 100]);
    tmp.write_all(&png).unwrap();
    tmp.flush().unwrap();

    let file = File::from_file(tmp.path(), None).await.unwrap();
    assert_eq!(file.mime_type(), Some("image/png"));
    assert_eq!(file.extension(), Some("png"));
}

#[tokio::test]
async fn test_from_url_with_wiremock() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let body = "Hello from wiremock!";

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(body)
                .insert_header("content-type", "text/plain")
                .insert_header("content-length", body.len().to_string().as_str())
                .insert_header("content-disposition", "attachment; filename=\"hello.txt\"")
                .insert_header("etag", "\"abc123\"")
                .insert_header("last-modified", "Mon, 01 Jan 2024 00:00:00 GMT"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/hello.txt", server.uri());
    let file = File::from_url(&url, None).await.unwrap();

    assert_eq!(file.source(), FileSource::Url);
    assert_eq!(file.name(), Some("hello.txt"));
    assert_eq!(file.mime_type(), Some("text/plain"));
    assert_eq!(file.size(), Some(body.len() as u64));
    assert_eq!(file.hash(), Some("abc123"));
    assert!(file.last_modified().is_some());
    assert!(file.url().is_some());

    let text = file.read_text().await.unwrap();
    assert_eq!(text, body);
}

#[tokio::test]
async fn test_from_url_binary_detection() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend_from_slice(&[0; 100]);

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(png.clone())
                .insert_header("content-type", "application/octet-stream"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/image.png", server.uri());
    let file = File::from_url(&url, None).await.unwrap();

    // Should detect PNG from magic bytes even though content-type is octet-stream
    assert_eq!(file.mime_type(), Some("image/png"));
    assert_eq!(file.extension(), Some("png"));
}

#[tokio::test]
async fn test_from_url_no_content_disposition() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("data")
                .insert_header("content-type", "text/plain"),
        )
        .mount(&server)
        .await;

    let url = format!("{}/some/path/document.txt", server.uri());
    let file = File::from_url(&url, None).await.unwrap();

    // Should extract name from URL path
    assert_eq!(file.name(), Some("document.txt"));
}

#[tokio::test]
async fn test_metadata_read_write() {
    let data = Bytes::from("test content");
    let mut file = File::from_bytes(data, None).await.unwrap();

    assert!(file.name().is_none());

    file.set_metadata(Metadata {
        name: Some("updated.txt".to_string()),
        mime_type: Some("text/plain".to_string()),
        ..Default::default()
    });

    assert_eq!(file.name(), Some("updated.txt"));
    assert_eq!(file.mime_type(), Some("text/plain"));
    // Size should remain unchanged
    assert_eq!(file.size(), Some(12));
}

#[tokio::test]
async fn test_checksum_deterministic() {
    let data = Bytes::from("deterministic content");
    let file = File::from_bytes(data, None).await.unwrap();

    let checksum1 = file.checksum().await.unwrap();
    let checksum2 = file.checksum().await.unwrap();

    assert_eq!(checksum1, checksum2);
    assert_eq!(checksum1.len(), 64);
}

#[tokio::test]
async fn test_checksum_different_content() {
    let file1 = File::from_bytes(Bytes::from("content a"), None).await.unwrap();
    let file2 = File::from_bytes(Bytes::from("content b"), None).await.unwrap();

    let checksum1 = file1.checksum().await.unwrap();
    let checksum2 = file2.checksum().await.unwrap();

    assert_ne!(checksum1, checksum2);
}

#[tokio::test]
async fn test_save_to_disk() {
    let data = Bytes::from("save me to disk");
    let file = File::from_bytes(data, None).await.unwrap();

    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("saved.txt");
    let dest_str = dest.to_str().unwrap();

    let (original, new_file) = file.save(dest_str).await.unwrap();

    // Original should still work
    assert_eq!(original.read_text().await.unwrap(), "save me to disk");

    // New file should be from filesystem
    assert_eq!(new_file.source(), FileSource::File);
    assert_eq!(new_file.read_text().await.unwrap(), "save me to disk");
    assert_eq!(new_file.path(), Some(dest_str));
}

#[tokio::test]
async fn test_move_to_from_file() {
    let mut tmp = NamedTempFile::new().unwrap();
    write!(tmp, "move me").unwrap();
    tmp.flush().unwrap();
    let original_path = tmp.path().to_string_lossy().to_string();

    let file = File::from_file(tmp.path(), None).await.unwrap();

    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("moved.txt");
    let dest_str = dest.to_str().unwrap();

    let moved_file = file.move_to(dest_str).await.unwrap();

    assert_eq!(moved_file.source(), FileSource::File);
    assert_eq!(moved_file.read_text().await.unwrap(), "move me");

    // Original should be deleted
    assert!(!std::path::Path::new(&original_path).exists());
}

#[tokio::test]
async fn test_move_to_from_bytes() {
    let data = Bytes::from("move bytes");
    let file = File::from_bytes(data, None).await.unwrap();

    let tmp_dir = tempfile::tempdir().unwrap();
    let dest = tmp_dir.path().join("moved.txt");
    let dest_str = dest.to_str().unwrap();

    let moved_file = file.move_to(dest_str).await.unwrap();
    assert_eq!(moved_file.source(), FileSource::File);
    assert_eq!(moved_file.read_text().await.unwrap(), "move bytes");
}

#[tokio::test]
async fn test_delete_file() {
    let mut tmp = NamedTempFile::new().unwrap();
    write!(tmp, "delete me").unwrap();
    tmp.flush().unwrap();
    let path = tmp.path().to_path_buf();

    // Keep the tempfile handle so it doesn't auto-delete
    let file = File::from_file(&path, None).await.unwrap();

    assert!(path.exists());
    file.delete().await.unwrap();
    assert!(!path.exists());
}

#[tokio::test]
async fn test_delete_non_file_source_is_noop() {
    let file = File::from_bytes(Bytes::from("test"), None).await.unwrap();
    // Should not error
    file.delete().await.unwrap();
}

#[tokio::test]
async fn test_from_stream() {
    let chunks: Vec<std::result::Result<Bytes, std::io::Error>> = vec![
        Ok(Bytes::from("chunk1")),
        Ok(Bytes::from("chunk2")),
        Ok(Bytes::from("chunk3")),
    ];
    let stream = futures::stream::iter(chunks);

    let file = File::from_stream(stream, None).await.unwrap();
    assert_eq!(file.source(), FileSource::Stream);
    assert_eq!(file.read_text().await.unwrap(), "chunk1chunk2chunk3");
    assert_eq!(file.size(), Some(18));
}

#[tokio::test]
async fn test_display_format() {
    let hint = Metadata {
        name: Some("test.txt".to_string()),
        ..Default::default()
    };
    let file = File::from_bytes(Bytes::from("content"), Some(hint))
        .await
        .unwrap();
    let display = file.to_string();
    assert!(display.contains("test.txt"));
    assert!(display.contains("Bytes"));
}

#[tokio::test]
async fn test_debug_format() {
    let file = File::from_bytes(Bytes::from("content"), None)
        .await
        .unwrap();
    let debug = format!("{:?}", file);
    assert!(debug.contains("File"));
    assert!(debug.contains("Bytes"));
    assert!(debug.contains("data_len"));
}

#[tokio::test]
async fn test_signed_url_non_s3_error() {
    let file = File::from_bytes(Bytes::from("test"), None).await.unwrap();
    let result = file.get_signed_url(3600).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("non-S3"));
}
