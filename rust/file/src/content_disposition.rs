//! Content-Disposition header parsing.
//!
//! Extracts the filename from HTTP Content-Disposition headers following
//! RFC 6266 / RFC 2616 patterns.

/// Parsed content disposition data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentDisposition {
    /// The disposition type (e.g., "attachment", "inline").
    pub disposition_type: String,
    /// The filename parameter, if present.
    pub filename: Option<String>,
}

/// Parse a Content-Disposition header value.
///
/// Supports forms like:
/// - `attachment; filename="example.txt"`
/// - `attachment; filename=example.txt`
/// - `inline; filename="example.txt"`
/// - `attachment; filename*=UTF-8''example%20file.txt` (RFC 5987)
///
/// Returns `None` if the header value is empty.
pub fn parse_content_disposition(header: &str) -> Option<ContentDisposition> {
    let header = header.trim();
    if header.is_empty() {
        return None;
    }

    // Split disposition type from parameters
    let mut parts = header.splitn(2, ';');
    let disposition_type = parts.next()?.trim().to_lowercase();
    let params_str = parts.next().unwrap_or("");

    let mut filename: Option<String> = None;
    let mut filename_star: Option<String> = None;

    // Parse parameters
    for param in params_str.split(';') {
        let param = param.trim();
        if param.is_empty() {
            continue;
        }

        if let Some((key, value)) = param.split_once('=') {
            let key = key.trim().to_lowercase();
            let value = value.trim();

            match key.as_str() {
                "filename" => {
                    // Remove surrounding quotes if present
                    filename = Some(unquote(value).to_string());
                }
                "filename*" => {
                    // RFC 5987 encoded filename: encoding'language'value
                    // e.g., UTF-8''example%20file.txt
                    if let Some(encoded_value) = value.split('\'').nth(2) {
                        filename_star = Some(percent_decode(encoded_value));
                    }
                }
                _ => {}
            }
        }
    }

    // RFC 6266: filename* takes precedence over filename
    let resolved_filename = filename_star.or(filename);

    Some(ContentDisposition {
        disposition_type,
        filename: resolved_filename,
    })
}

/// Remove surrounding double quotes from a string.
fn unquote(s: &str) -> &str {
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Simple percent-decode for RFC 5987 encoded values.
fn percent_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&result).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_attachment_with_quoted_filename() {
        let cd = parse_content_disposition("attachment; filename=\"example.txt\"").unwrap();
        assert_eq!(cd.disposition_type, "attachment");
        assert_eq!(cd.filename.as_deref(), Some("example.txt"));
    }

    #[test]
    fn test_parse_attachment_with_unquoted_filename() {
        let cd = parse_content_disposition("attachment; filename=example.txt").unwrap();
        assert_eq!(cd.disposition_type, "attachment");
        assert_eq!(cd.filename.as_deref(), Some("example.txt"));
    }

    #[test]
    fn test_parse_inline() {
        let cd = parse_content_disposition("inline; filename=\"photo.jpg\"").unwrap();
        assert_eq!(cd.disposition_type, "inline");
        assert_eq!(cd.filename.as_deref(), Some("photo.jpg"));
    }

    #[test]
    fn test_parse_no_filename() {
        let cd = parse_content_disposition("attachment").unwrap();
        assert_eq!(cd.disposition_type, "attachment");
        assert!(cd.filename.is_none());
    }

    #[test]
    fn test_parse_empty() {
        assert!(parse_content_disposition("").is_none());
    }

    #[test]
    fn test_parse_rfc5987_filename_star() {
        let cd =
            parse_content_disposition("attachment; filename*=UTF-8''example%20file.txt").unwrap();
        assert_eq!(cd.disposition_type, "attachment");
        assert_eq!(cd.filename.as_deref(), Some("example file.txt"));
    }

    #[test]
    fn test_filename_star_takes_precedence() {
        let cd = parse_content_disposition(
            "attachment; filename=\"fallback.txt\"; filename*=UTF-8''preferred.txt",
        )
        .unwrap();
        assert_eq!(cd.filename.as_deref(), Some("preferred.txt"));
    }

    #[test]
    fn test_parse_case_insensitive_type() {
        let cd = parse_content_disposition("Attachment; filename=\"test.txt\"").unwrap();
        assert_eq!(cd.disposition_type, "attachment");
    }

    #[test]
    fn test_unquote() {
        assert_eq!(unquote("\"hello\""), "hello");
        assert_eq!(unquote("hello"), "hello");
        assert_eq!(unquote("\"\""), "");
        assert_eq!(unquote("\""), "\"");
    }

    #[test]
    fn test_percent_decode() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("test%2Fpath"), "test/path");
        assert_eq!(percent_decode("no_encoding"), "no_encoding");
    }
}
