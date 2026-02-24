//! Integration tests for file type detection.

use smooai_file::detection::{
    detect_from_bytes, detect_from_filename, extension_from_mime, mime_from_extension,
};

#[test]
fn test_detect_png_magic_bytes() {
    let png_header: Vec<u8> = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // IHDR chunk
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ];
    let result = detect_from_bytes(&png_header, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/png"));
    assert_eq!(result.extension.as_deref(), Some("png"));
}

#[test]
fn test_detect_jpeg_magic_bytes() {
    let mut jpeg_header = vec![0xFF, 0xD8, 0xFF, 0xE0];
    jpeg_header.extend_from_slice(&[0; 100]);
    let result = detect_from_bytes(&jpeg_header, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/jpeg"));
    assert_eq!(result.extension.as_deref(), Some("jpg"));
}

#[test]
fn test_detect_pdf_magic_bytes() {
    let pdf_bytes = b"%PDF-1.7 some content follows";
    let result = detect_from_bytes(pdf_bytes, None);
    assert_eq!(result.mime_type.as_deref(), Some("application/pdf"));
    assert_eq!(result.extension.as_deref(), Some("pdf"));
}

#[test]
fn test_detect_gif_magic_bytes() {
    // Minimal GIF89a
    let gif_bytes: Vec<u8> = vec![
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // logical screen descriptor
        0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, // global color table
        0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // graphic control extension
        0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
        0x02, 0x02, 0x44, 0x01, 0x00, // image data
        0x3B, // trailer
    ];
    let result = detect_from_bytes(&gif_bytes, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/gif"));
    assert_eq!(result.extension.as_deref(), Some("gif"));
}

#[test]
fn test_detect_zip_magic_bytes() {
    let mut zip_bytes = vec![0x50, 0x4B, 0x03, 0x04];
    zip_bytes.extend_from_slice(&[0; 100]);
    let result = detect_from_bytes(&zip_bytes, None);
    assert_eq!(result.mime_type.as_deref(), Some("application/zip"));
    assert_eq!(result.extension.as_deref(), Some("zip"));
}

#[test]
fn test_detect_webp_magic_bytes() {
    // RIFF....WEBP
    let mut webp_bytes = vec![
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // size placeholder
        0x57, 0x45, 0x42, 0x50, // WEBP
    ];
    webp_bytes.extend_from_slice(&[0; 100]);
    let result = detect_from_bytes(&webp_bytes, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/webp"));
    assert_eq!(result.extension.as_deref(), Some("webp"));
}

#[test]
fn test_detect_svg_from_bytes() {
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>"#;
    let result = detect_from_bytes(svg, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/svg+xml"));
    assert_eq!(result.extension.as_deref(), Some("svg"));
}

#[test]
fn test_detect_svg_with_xml_declaration() {
    let svg = br#"<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>"#;
    let result = detect_from_bytes(svg, None);
    assert_eq!(result.mime_type.as_deref(), Some("image/svg+xml"));
    assert_eq!(result.extension.as_deref(), Some("svg"));
}

#[test]
fn test_detect_xml_from_bytes() {
    let xml = br#"<?xml version="1.0" encoding="UTF-8"?><root><item>data</item></root>"#;
    let result = detect_from_bytes(xml, None);
    assert_eq!(result.mime_type.as_deref(), Some("application/xml"));
    assert_eq!(result.extension.as_deref(), Some("xml"));
}

#[test]
fn test_detect_html_from_bytes() {
    let html = b"<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>";
    let result = detect_from_bytes(html, None);
    assert_eq!(result.mime_type.as_deref(), Some("text/html"));
    assert_eq!(result.extension.as_deref(), Some("html"));
}

#[test]
fn test_detect_unknown_with_filename_fallback() {
    let text = b"just some text data that cannot be detected";
    let result = detect_from_bytes(text, Some("readme.md"));
    assert_eq!(result.mime_type.as_deref(), Some("text/markdown"));
    assert_eq!(result.extension.as_deref(), Some("md"));
}

#[test]
fn test_detect_unknown_no_fallback() {
    let text = b"just some text";
    let result = detect_from_bytes(text, None);
    assert!(result.mime_type.is_none());
    assert!(result.extension.is_none());
}

#[test]
fn test_detect_from_filename_pdf() {
    let result = detect_from_filename("report.pdf");
    assert_eq!(result.mime_type.as_deref(), Some("application/pdf"));
    assert_eq!(result.extension.as_deref(), Some("pdf"));
}

#[test]
fn test_detect_from_filename_js() {
    let result = detect_from_filename("app.js");
    // mime_guess returns application/javascript
    assert!(result.mime_type.is_some());
    assert_eq!(result.extension.as_deref(), Some("js"));
}

#[test]
fn test_detect_from_filename_css() {
    let result = detect_from_filename("styles.css");
    assert_eq!(result.mime_type.as_deref(), Some("text/css"));
    assert_eq!(result.extension.as_deref(), Some("css"));
}

#[test]
fn test_detect_from_filename_docx() {
    let result = detect_from_filename("document.docx");
    assert_eq!(
        result.mime_type.as_deref(),
        Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    );
    assert_eq!(result.extension.as_deref(), Some("docx"));
}

#[test]
fn test_mime_from_extension_known() {
    assert_eq!(mime_from_extension("png").as_deref(), Some("image/png"));
    assert_eq!(mime_from_extension("html").as_deref(), Some("text/html"));
    assert_eq!(
        mime_from_extension("pdf").as_deref(),
        Some("application/pdf")
    );
    assert_eq!(
        mime_from_extension("json").as_deref(),
        Some("application/json")
    );
}

#[test]
fn test_extension_from_mime_known() {
    let ext = extension_from_mime("image/png");
    assert_eq!(ext.as_deref(), Some("png"));

    let ext = extension_from_mime("application/pdf");
    assert_eq!(ext.as_deref(), Some("pdf"));
}

#[test]
fn test_extension_from_mime_unknown() {
    let ext = extension_from_mime("application/x-unknown-type-12345");
    assert!(ext.is_none());
}
