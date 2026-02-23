//! SmooAI File Library for Rust.
//!
//! A unified file handling library for working with files from local filesystem,
//! S3, URLs, and streams.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(VERSION, "1.1.5");
    }
}
