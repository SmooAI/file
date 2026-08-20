//! The Rust loader for the shared lazy-streaming contract.
//!
//! Every port has one of these and they all read the SAME file
//! (`spec/lazy-stream-contract.json`). Copying the numbers into this test
//! instead is the drift this fixture exists to stop.
//!
//! Deliberately NOT behind a `#![cfg(feature = ...)]` gate: CI runs a bare
//! `cargo test`, and a feature-gated test file reports "0 passed; ok" — a
//! contract nobody runs reads as a guarantee while enforcing nothing.

use std::io;
use std::path::PathBuf;

use bytes::Bytes;
use futures::StreamExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use smooai_file::{File, LAZY_HEAD_BYTES};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractCase {
    name: String,
    source_bytes: usize,
    lazy_after_construct: bool,
    size_known_after_construct: bool,
    sha256: String,
}

#[derive(Deserialize)]
struct Fill {
    pattern: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EagerConstructor {
    lazy_after_construct: bool,
    size_known_after_construct: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullRead {
    read_caches: bool,
    iter_caches: bool,
    payload_replayed_after_iteration: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    head_bytes: usize,
    fill: Fill,
    cases: Vec<ContractCase>,
    eager_constructor: EagerConstructor,
    full_read: FullRead,
}

fn contract() -> Contract {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/lazy-stream-contract.json");
    let raw =
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let contract: Contract = serde_json::from_str(&raw).expect("parse lazy-stream-contract.json");
    assert!(
        !contract.cases.is_empty(),
        "contract has no cases — a fixture nobody exercises is worse than none"
    );
    contract
}

fn source_bytes(contract: &Contract, byte_length: usize) -> Vec<u8> {
    contract
        .fill
        .pattern
        .as_bytes()
        .iter()
        .copied()
        .cycle()
        .take(byte_length)
        .collect()
}

/// Delivers the payload in small chunks, like a socket would.
fn chunked_reader(payload: Vec<u8>) -> impl tokio::io::AsyncRead + Send + Unpin + 'static {
    let stream = futures::stream::iter(
        payload
            .chunks(4096)
            .map(|chunk| Ok::<Bytes, io::Error>(Bytes::copy_from_slice(chunk)))
            .collect::<Vec<_>>(),
    );
    tokio_util::io::StreamReader::new(stream)
}

fn chunked_stream(
    payload: Vec<u8>,
) -> impl futures::Stream<Item = Result<Bytes, io::Error>> + Unpin {
    futures::stream::iter(
        payload
            .chunks(4096)
            .map(|chunk| Ok::<Bytes, io::Error>(Bytes::copy_from_slice(chunk)))
            .collect::<Vec<_>>(),
    )
}

fn hex_sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[test]
fn head_bytes_matches_contract() {
    assert_eq!(LAZY_HEAD_BYTES, contract().head_bytes);
}

#[test]
fn fixture_content_is_reproducible() {
    // Positive control: without this, a broken source_bytes() would make every
    // assertion below compare two identically-wrong values and pass.
    let contract = contract();
    for case in &contract.cases {
        let payload = source_bytes(&contract, case.source_bytes);
        assert_eq!(payload.len(), case.source_bytes, "{}", case.name);
        assert_eq!(hex_sha256(&payload), case.sha256, "{}", case.name);
    }
}

#[tokio::test]
async fn lazy_constructor_laziness() {
    let contract = contract();
    for case in &contract.cases {
        let payload = source_bytes(&contract, case.source_bytes);
        let file = File::from_stream_lazy(chunked_reader(payload), None)
            .await
            .unwrap_or_else(|e| panic!("{}: from_stream_lazy: {e}", case.name));

        assert_eq!(file.is_lazy(), case.lazy_after_construct, "{}", case.name);
        assert_eq!(
            file.size().is_some(),
            case.size_known_after_construct,
            "{}",
            case.name
        );
    }
}

#[tokio::test]
async fn full_read_yields_every_byte() {
    let contract = contract();
    for case in &contract.cases {
        let payload = source_bytes(&contract, case.source_bytes);
        let file = File::from_stream_lazy(chunked_reader(payload), None)
            .await
            .unwrap();
        let data = file.read().await.unwrap();

        assert_eq!(data.len(), case.source_bytes, "{}", case.name);
        assert_eq!(hex_sha256(&data), case.sha256, "{}", case.name);
    }
}

#[tokio::test]
async fn iteration_yields_every_byte() {
    let contract = contract();
    for case in &contract.cases {
        let payload = source_bytes(&contract, case.source_bytes);
        let file = File::from_stream_lazy(chunked_reader(payload), None)
            .await
            .unwrap();

        let mut hasher = Sha256::new();
        let mut total = 0usize;
        let mut stream = file.iter_bytes();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.unwrap();
            total += chunk.len();
            hasher.update(&chunk);
        }

        assert_eq!(total, case.source_bytes, "{}", case.name);
        assert_eq!(hex::encode(hasher.finalize()), case.sha256, "{}", case.name);
    }
}

#[tokio::test]
async fn eager_constructor_buffers_everything() {
    let contract = contract();
    for case in &contract.cases {
        let payload = source_bytes(&contract, case.source_bytes);
        let file = File::from_stream(chunked_stream(payload), None)
            .await
            .unwrap();

        assert_eq!(
            file.is_lazy(),
            contract.eager_constructor.lazy_after_construct,
            "{}",
            case.name
        );
        assert_eq!(
            file.size().is_some(),
            contract.eager_constructor.size_known_after_construct,
            "{}",
            case.name
        );
        assert_eq!(file.size(), Some(case.source_bytes as u64), "{}", case.name);
    }
}

#[tokio::test]
async fn read_caches_and_iteration_does_not() {
    let contract = contract();
    assert!(contract.full_read.read_caches);
    assert!(!contract.full_read.iter_caches);
    assert!(!contract.full_read.payload_replayed_after_iteration);

    let case = contract.cases.last().unwrap();
    let payload = source_bytes(&contract, case.source_bytes);

    let cached = File::from_stream_lazy(chunked_reader(payload.clone()), None)
        .await
        .unwrap();
    assert_eq!(hex_sha256(&cached.read().await.unwrap()), case.sha256);
    // Before TailState, this second read returned only the 64 KiB detection
    // head — silent truncation dressed up as a successful read.
    assert_eq!(hex_sha256(&cached.read().await.unwrap()), case.sha256);

    let consumed = File::from_stream_lazy(chunked_reader(payload), None)
        .await
        .unwrap();
    let mut stream = consumed.iter_bytes();
    while let Some(chunk) = stream.next().await {
        chunk.unwrap();
    }
    drop(stream);
    let leftovers = consumed.read().await.unwrap();
    assert_ne!(leftovers.len(), case.source_bytes);
    assert!(leftovers.is_empty());
}
