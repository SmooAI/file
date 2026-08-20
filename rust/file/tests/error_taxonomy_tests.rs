//! The Rust loader for the shared error taxonomy.
//!
//! Every port has one of these and they all read the SAME file
//! (`spec/error-taxonomy.json`). Copying the `kind` values into this test
//! instead is the drift the fixture exists to stop.

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::Deserialize;
use smooai_file::FileValidationError;

#[derive(Deserialize)]
struct KindSpec {
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaxonomyCase {
    name: String,
    kind: String,
    #[serde(default)]
    actual_size: Option<u64>,
    #[serde(default)]
    max_size: Option<u64>,
    #[serde(default)]
    actual_mime_type: Option<String>,
    #[serde(default)]
    allowed_mime_types: Option<Vec<String>>,
    #[serde(default)]
    claimed_mime_type: Option<String>,
    #[serde(default)]
    detected_mime_type: Option<String>,
}

#[derive(Deserialize)]
struct Taxonomy {
    kinds: std::collections::BTreeMap<String, KindSpec>,
    cases: Vec<TaxonomyCase>,
}

fn taxonomy() -> Taxonomy {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/error-taxonomy.json");
    let raw =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let taxonomy: Taxonomy = serde_json::from_str(&raw).expect("parse error-taxonomy.json");
    assert!(
        !taxonomy.cases.is_empty(),
        "taxonomy has no cases — a fixture nobody exercises is worse than none"
    );
    taxonomy
}

fn build(taxonomy: &Taxonomy, case: &TaxonomyCase) -> FileValidationError {
    let kind_value = |name: &str| taxonomy.kinds[name].value.as_str();

    if case.kind == kind_value("size") {
        FileValidationError::SizeExceeded {
            actual: case.actual_size,
            max: case.max_size.expect("size case needs maxSize"),
        }
    } else if case.kind == kind_value("mime") {
        FileValidationError::MimeNotAllowed {
            actual: case.actual_mime_type.clone(),
            allowed: case
                .allowed_mime_types
                .clone()
                .expect("mime case needs allowedMimeTypes"),
        }
    } else if case.kind == kind_value("contentMismatch") {
        FileValidationError::ContentMismatch {
            claimed: case.claimed_mime_type.clone(),
            detected: case.detected_mime_type.clone(),
        }
    } else {
        panic!("fixture has an unknown kind: {}", case.kind);
    }
}

#[test]
fn exposes_exactly_the_declared_kinds() {
    let taxonomy = taxonomy();
    let declared: BTreeSet<&str> = taxonomy.kinds.values().map(|k| k.value.as_str()).collect();

    // Every variant, listed exhaustively so a NEW variant added without a `kind`
    // arm fails to compile here rather than silently escaping the taxonomy.
    let exposed: BTreeSet<&str> = [
        FileValidationError::SizeExceeded {
            actual: None,
            max: 0,
        },
        FileValidationError::MimeNotAllowed {
            actual: None,
            allowed: vec![],
        },
        FileValidationError::ContentMismatch {
            claimed: None,
            detected: None,
        },
    ]
    .iter()
    .map(|e| e.kind())
    .collect();

    assert_eq!(exposed, declared);
}

#[test]
fn cases_cover_every_declared_kind() {
    // Positive control: a fixture that silently lost a kind would leave the loop
    // below asserting nothing about it, while still passing.
    let taxonomy = taxonomy();
    let covered: BTreeSet<&str> = taxonomy.cases.iter().map(|c| c.kind.as_str()).collect();
    let declared: BTreeSet<&str> = taxonomy.kinds.values().map(|k| k.value.as_str()).collect();
    assert_eq!(covered, declared);
}

#[test]
fn carries_the_portable_kind_and_fields() {
    let taxonomy = taxonomy();
    for case in &taxonomy.cases {
        let error = build(&taxonomy, case);
        assert_eq!(error.kind(), case.kind, "{}", case.name);

        match &error {
            FileValidationError::SizeExceeded { actual, max } => {
                assert_eq!(*actual, case.actual_size, "{}", case.name);
                assert_eq!(Some(*max), case.max_size, "{}", case.name);
            }
            FileValidationError::MimeNotAllowed { actual, allowed } => {
                assert_eq!(*actual, case.actual_mime_type, "{}", case.name);
                assert_eq!(
                    Some(allowed.clone()),
                    case.allowed_mime_types,
                    "{}",
                    case.name
                );
            }
            FileValidationError::ContentMismatch { claimed, detected } => {
                assert_eq!(*claimed, case.claimed_mime_type, "{}", case.name);
                assert_eq!(*detected, case.detected_mime_type, "{}", case.name);
            }
        }

        // The wording is deliberately NOT pinned across ports — Go's is
        // idiomatically Go. That every port says something is still worth checking.
        assert!(!error.to_string().is_empty(), "{}", case.name);
    }
}
