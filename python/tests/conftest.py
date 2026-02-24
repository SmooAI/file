"""Shared fixtures for smooai-file tests."""

from __future__ import annotations

import os
import struct
import tempfile

import boto3
import pytest
from moto import mock_aws


# ---------------------------------------------------------------------------
# Byte fixtures for common file types
# ---------------------------------------------------------------------------

# Minimal valid PNG: 8-byte signature + IHDR + IDAT + IEND
# This is a 1x1 pixel transparent PNG.
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _make_png_bytes() -> bytes:
    """Build a minimal valid 1x1 PNG."""
    import zlib

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        raw = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(raw) & 0xFFFFFFFF)
        length = struct.pack(">I", len(data))
        return length + raw + crc

    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit RGB
    raw_scanline = b"\x00\xff\x00\x00"  # filter byte + RGB
    compressed = zlib.compress(raw_scanline)

    return PNG_SIGNATURE + _chunk(b"IHDR", ihdr_data) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")


# Minimal valid JPEG (JFIF)
def _make_jpeg_bytes() -> bytes:
    """Build minimal JPEG bytes (SOI + APP0 JFIF marker + EOI)."""
    soi = b"\xff\xd8"
    # APP0 JFIF marker
    app0 = (
        b"\xff\xe0"  # marker
        + struct.pack(">H", 16)  # length
        + b"JFIF\x00"  # identifier
        + b"\x01\x01"  # version
        + b"\x00"  # units
        + struct.pack(">HH", 1, 1)  # density
        + b"\x00\x00"  # thumbnail
    )
    eoi = b"\xff\xd9"
    return soi + app0 + eoi


# Minimal PDF
def _make_pdf_bytes() -> bytes:
    """Build a minimal valid PDF."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
        b"xref\n0 3\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"trailer\n<< /Size 3 /Root 1 0 R >>\n"
        b"startxref\n109\n%%EOF\n"
    )


@pytest.fixture()
def png_bytes() -> bytes:
    return _make_png_bytes()


@pytest.fixture()
def jpeg_bytes() -> bytes:
    return _make_jpeg_bytes()


@pytest.fixture()
def pdf_bytes() -> bytes:
    return _make_pdf_bytes()


@pytest.fixture()
def text_bytes() -> bytes:
    return b"Hello, world! This is a plain text file for testing."


# ---------------------------------------------------------------------------
# Temporary file fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture()
def tmp_text_file(tmp_dir: str, text_bytes: bytes) -> str:
    """Write text_bytes to a temp file and return its path."""
    p = os.path.join(tmp_dir, "example.txt")
    with open(p, "wb") as f:
        f.write(text_bytes)
    return p


@pytest.fixture()
def tmp_png_file(tmp_dir: str, png_bytes: bytes) -> str:
    p = os.path.join(tmp_dir, "icon.png")
    with open(p, "wb") as f:
        f.write(png_bytes)
    return p


@pytest.fixture()
def tmp_pdf_file(tmp_dir: str, pdf_bytes: bytes) -> str:
    p = os.path.join(tmp_dir, "document.pdf")
    with open(p, "wb") as f:
        f.write(pdf_bytes)
    return p


# ---------------------------------------------------------------------------
# Moto S3 fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def aws_credentials(monkeypatch: pytest.MonkeyPatch):
    """Set dummy AWS credentials for moto."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")


@pytest.fixture()
def s3_mock(aws_credentials):
    """Provide a mocked S3 service via moto."""
    with mock_aws():
        yield


@pytest.fixture()
def s3_bucket(s3_mock) -> str:
    """Create and return an S3 bucket name inside the moto mock."""
    bucket_name = "test-bucket"
    client = boto3.client("s3", region_name="us-east-1")
    client.create_bucket(Bucket=bucket_name)
    return bucket_name


@pytest.fixture()
def s3_text_object(s3_bucket: str, text_bytes: bytes) -> tuple[str, str]:
    """Upload a text file to the mocked S3 and return (bucket, key)."""
    key = "files/example.txt"
    client = boto3.client("s3", region_name="us-east-1")
    client.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=text_bytes,
        ContentType="text/plain",
    )
    return s3_bucket, key


@pytest.fixture()
def s3_png_object(s3_bucket: str, png_bytes: bytes) -> tuple[str, str]:
    """Upload a PNG to mocked S3 and return (bucket, key)."""
    key = "images/icon.png"
    client = boto3.client("s3", region_name="us-east-1")
    client.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=png_bytes,
        ContentType="image/png",
    )
    return s3_bucket, key
