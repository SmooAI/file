//! MIME type and file extension detection.
//!
//! Detection strategy (in priority order):
//! 1. `infer` crate - magic byte detection for binary formats
//! 2. Custom SVG/XML detection for text-based XML formats
//! 3. `mime_guess` crate - extension-based fallback

/// Result of a detection attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectionResult {
    /// The detected MIME type (e.g., "image/png").
    pub mime_type: Option<String>,
    /// The detected file extension without dot (e.g., "png").
    pub extension: Option<String>,
}

/// Detect MIME type and extension from raw bytes using magic byte signatures.
///
/// This uses the `infer` crate first, then falls back to custom SVG/XML detection,
/// and finally uses `mime_guess` from a filename if provided.
pub fn detect_from_bytes(bytes: &[u8], filename: Option<&str>) -> DetectionResult {
    // Strategy 1: infer crate magic bytes
    if let Some(kind) = infer::get(bytes) {
        let mime = kind.mime_type();
        // If infer detected XML-like content, use our custom SVG/XML detector
        // which can distinguish SVG from generic XML and provide better types.
        if mime == "text/xml" || mime == "application/xml" {
            if let Some(result) = detect_svg_xml(bytes) {
                return result;
            }
        }
        return DetectionResult {
            mime_type: Some(mime.to_string()),
            extension: Some(kind.extension().to_string()),
        };
    }

    // Strategy 2: custom SVG/XML detection (for content infer doesn't recognize)
    if let Some(result) = detect_svg_xml(bytes) {
        return result;
    }

    // Strategy 3: mime_guess from filename
    if let Some(name) = filename {
        return detect_from_filename(name);
    }

    DetectionResult {
        mime_type: None,
        extension: None,
    }
}

/// Detect MIME type and extension from a filename using the `mime_guess` crate.
pub fn detect_from_filename(filename: &str) -> DetectionResult {
    let guess = mime_guess::from_path(filename);
    let mime_type = guess.first().map(|m| m.to_string());
    let extension = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_string());

    DetectionResult {
        mime_type,
        extension,
    }
}

/// Detect MIME type from a known extension string.
pub fn mime_from_extension(ext: &str) -> Option<String> {
    let guess = mime_guess::from_ext(ext);
    guess.first().map(|m| m.to_string())
}

/// Detect extension from a known MIME type string.
pub fn extension_from_mime(mime: &str) -> Option<String> {
    // Use mime_guess's reverse lookup
    let extensions = mime_guess::get_mime_extensions_str(mime);
    extensions.and_then(|exts| exts.first().copied()).map(|e| e.to_string())
}

/// Custom detection for SVG and XML content by inspecting the byte content.
fn detect_svg_xml(bytes: &[u8]) -> Option<DetectionResult> {
    // We need to look at the text content for SVG/XML
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            // Try a smaller prefix - some files may have valid UTF-8 at the start
            let len = bytes.len().min(4096);
            match std::str::from_utf8(&bytes[..len]) {
                Ok(s) => s,
                Err(_) => return None,
            }
        }
    };

    let trimmed = text.trim_start();

    // Check for SVG
    if trimmed.starts_with("<svg") || trimmed.starts_with("<?xml") && trimmed.contains("<svg") {
        return Some(DetectionResult {
            mime_type: Some("image/svg+xml".to_string()),
            extension: Some("svg".to_string()),
        });
    }

    // Check for generic XML
    if trimmed.starts_with("<?xml") || trimmed.starts_with("<!DOCTYPE") {
        return Some(DetectionResult {
            mime_type: Some("application/xml".to_string()),
            extension: Some("xml".to_string()),
        });
    }

    // Check for HTML
    if trimmed.starts_with("<!DOCTYPE html") || trimmed.starts_with("<html") {
        return Some(DetectionResult {
            mime_type: Some("text/html".to_string()),
            extension: Some("html".to_string()),
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_png() {
        // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
        let png_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let result = detect_from_bytes(&png_bytes, None);
        assert_eq!(result.mime_type.as_deref(), Some("image/png"));
        assert_eq!(result.extension.as_deref(), Some("png"));
    }

    #[test]
    fn test_detect_jpeg() {
        // JPEG magic bytes: FF D8 FF
        let mut jpeg_bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        jpeg_bytes.extend_from_slice(&[0; 100]);
        let result = detect_from_bytes(&jpeg_bytes, None);
        assert_eq!(result.mime_type.as_deref(), Some("image/jpeg"));
        assert_eq!(result.extension.as_deref(), Some("jpg"));
    }

    #[test]
    fn test_detect_pdf() {
        // PDF magic bytes: %PDF
        let pdf_bytes = b"%PDF-1.4 some content here";
        let result = detect_from_bytes(pdf_bytes, None);
        assert_eq!(result.mime_type.as_deref(), Some("application/pdf"));
        assert_eq!(result.extension.as_deref(), Some("pdf"));
    }

    #[test]
    fn test_detect_gif() {
        // GIF magic bytes: GIF89a
        let gif_bytes = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";
        let result = detect_from_bytes(gif_bytes, None);
        assert_eq!(result.mime_type.as_deref(), Some("image/gif"));
        assert_eq!(result.extension.as_deref(), Some("gif"));
    }

    #[test]
    fn test_detect_zip() {
        // ZIP magic bytes: PK\x03\x04
        let mut zip_bytes = vec![0x50, 0x4B, 0x03, 0x04];
        zip_bytes.extend_from_slice(&[0; 100]);
        let result = detect_from_bytes(&zip_bytes, None);
        assert_eq!(result.mime_type.as_deref(), Some("application/zip"));
        assert_eq!(result.extension.as_deref(), Some("zip"));
    }

    #[test]
    fn test_detect_svg() {
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>";
        let result = detect_from_bytes(svg, None);
        assert_eq!(result.mime_type.as_deref(), Some("image/svg+xml"));
        assert_eq!(result.extension.as_deref(), Some("svg"));
    }

    #[test]
    fn test_detect_svg_with_xml_prolog() {
        let svg = b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>";
        let result = detect_from_bytes(svg, None);
        assert_eq!(result.mime_type.as_deref(), Some("image/svg+xml"));
        assert_eq!(result.extension.as_deref(), Some("svg"));
    }

    #[test]
    fn test_detect_xml() {
        let xml = b"<?xml version=\"1.0\"?><root><item/></root>";
        let result = detect_from_bytes(xml, None);
        assert_eq!(result.mime_type.as_deref(), Some("application/xml"));
        assert_eq!(result.extension.as_deref(), Some("xml"));
    }

    #[test]
    fn test_detect_html() {
        let html = b"<!DOCTYPE html><html><body>hello</body></html>";
        let result = detect_from_bytes(html, None);
        assert_eq!(result.mime_type.as_deref(), Some("text/html"));
        assert_eq!(result.extension.as_deref(), Some("html"));
    }

    #[test]
    fn test_detect_from_filename() {
        let result = detect_from_filename("document.pdf");
        assert_eq!(result.mime_type.as_deref(), Some("application/pdf"));
        assert_eq!(result.extension.as_deref(), Some("pdf"));
    }

    #[test]
    fn test_detect_from_filename_txt() {
        let result = detect_from_filename("readme.txt");
        assert_eq!(result.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(result.extension.as_deref(), Some("txt"));
    }

    #[test]
    fn test_detect_unknown_bytes_with_filename_fallback() {
        let bytes = b"some random text content";
        let result = detect_from_bytes(bytes, Some("notes.txt"));
        assert_eq!(result.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(result.extension.as_deref(), Some("txt"));
    }

    #[test]
    fn test_detect_unknown_bytes_no_filename() {
        let bytes = b"some random text content";
        let result = detect_from_bytes(bytes, None);
        assert!(result.mime_type.is_none());
        assert!(result.extension.is_none());
    }

    #[test]
    fn test_mime_from_extension() {
        assert_eq!(
            mime_from_extension("png").as_deref(),
            Some("image/png")
        );
        assert_eq!(
            mime_from_extension("pdf").as_deref(),
            Some("application/pdf")
        );
    }

    #[test]
    fn test_extension_from_mime() {
        let ext = extension_from_mime("image/png");
        assert_eq!(ext.as_deref(), Some("png"));
    }

    #[test]
    fn test_extension_from_unknown_mime() {
        let ext = extension_from_mime("application/x-totally-unknown-thing");
        assert!(ext.is_none());
    }
}
