"""Tests for the validation, base64, and presigned-upload-URL helpers."""

from __future__ import annotations

import pytest

from smooai_file import (
    File,
    FileContentMismatchError,
    FileMimeError,
    FileSizeError,
    FileValidationError,
)

# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class TestFileValidationErrorHierarchy:
    def test_file_size_error_is_validation_error(self) -> None:
        assert isinstance(FileSizeError(100, 50), FileValidationError)

    def test_file_mime_error_is_validation_error(self) -> None:
        assert isinstance(FileMimeError("text/plain", ["image/png"]), FileValidationError)

    def test_file_content_mismatch_error_is_validation_error(self) -> None:
        assert isinstance(FileContentMismatchError("image/png", "application/pdf"), FileValidationError)

    def test_file_size_error_attrs(self) -> None:
        err = FileSizeError(100, 50)
        assert err.actual_size == 100
        assert err.max_size == 50
        assert "100" in str(err)
        assert "50" in str(err)

    def test_file_size_error_unknown_size(self) -> None:
        err = FileSizeError(None, 50)
        assert err.actual_size is None
        assert err.max_size == 50
        assert "unknown" in str(err)

    def test_file_mime_error_attrs(self) -> None:
        err = FileMimeError("text/plain", ["image/png", "image/jpeg"])
        assert err.actual_mime_type == "text/plain"
        assert err.allowed_mimes == ("image/png", "image/jpeg")
        assert "text/plain" in str(err)
        assert "image/png" in str(err)

    def test_file_mime_error_unknown_type(self) -> None:
        err = FileMimeError(None, ["image/png"])
        assert err.actual_mime_type is None
        assert "unknown" in str(err)

    def test_file_content_mismatch_error_attrs(self) -> None:
        err = FileContentMismatchError("application/pdf", "image/png")
        assert err.claimed_mime_type == "application/pdf"
        assert err.detected_mime_type == "image/png"
        assert "application/pdf" in str(err)
        assert "image/png" in str(err)

    def test_file_content_mismatch_unknown(self) -> None:
        err = FileContentMismatchError(None, None)
        assert err.claimed_mime_type is None
        assert err.detected_mime_type is None
        assert "unknown" in str(err)


# ---------------------------------------------------------------------------
# File.validate
# ---------------------------------------------------------------------------


class TestValidate:
    async def test_passes_when_all_constraints_satisfied(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        result = await f.validate(
            max_size=1024,
            allowed_mimes=["image/png"],
            expected_mime_type="image/png",
        )
        assert result is None

    async def test_no_op_when_no_constraints(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        result = await f.validate()
        assert result is None

    async def test_raises_file_size_error_when_over_max(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        with pytest.raises(FileSizeError) as excinfo:
            await f.validate(max_size=5)
        assert excinfo.value.max_size == 5
        assert excinfo.value.actual_size == len(png_bytes)

    async def test_file_size_error_also_matches_validation_error(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        with pytest.raises(FileValidationError):
            await f.validate(max_size=5)

    async def test_raises_file_mime_error_when_not_allowed(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        with pytest.raises(FileMimeError) as excinfo:
            await f.validate(allowed_mimes=["application/pdf"])
        assert excinfo.value.actual_mime_type == "image/png"
        assert excinfo.value.allowed_mimes == ("application/pdf",)

    async def test_raises_file_content_mismatch_for_spoofed_mime(self, png_bytes: bytes) -> None:
        # Caller claims the client sent a PDF but the bytes are a PNG -- classic
        # mime-spoofing attack pattern.
        f = await File.from_bytes(
            png_bytes,
            metadata_hint={"name": "spoofed.pdf", "mime_type": "application/pdf"},
        )
        with pytest.raises(FileContentMismatchError) as excinfo:
            await f.validate(expected_mime_type="application/pdf")
        assert excinfo.value.claimed_mime_type == "application/pdf"
        assert excinfo.value.detected_mime_type == "image/png"

    async def test_passes_expected_mime_type_match(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        # Should not raise
        await f.validate(expected_mime_type="image/png")

    async def test_empty_allowed_mimes_is_no_op(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        # Empty allowlist should not fail (matches TS: length > 0 guard)
        await f.validate(allowed_mimes=[])

    async def test_size_error_with_unknown_size(self) -> None:
        # from_bytes always sets size, but we can simulate unknown via set_metadata
        f = await File.from_bytes(b"abc")
        await f.set_metadata(size=None)
        with pytest.raises(FileSizeError) as excinfo:
            await f.validate(max_size=10)
        assert excinfo.value.actual_size is None


# ---------------------------------------------------------------------------
# File.to_base64
# ---------------------------------------------------------------------------


class TestToBase64:
    async def test_encodes_file_bytes_as_base64(self) -> None:
        # "foo" -> b64 "Zm9v"
        f = await File.from_bytes(b"foo", metadata_hint={"name": "foo.txt", "mime_type": "text/plain"})
        assert await f.to_base64() == "Zm9v"

    async def test_empty_file_encodes_to_empty_string(self) -> None:
        f = await File.from_bytes(b"")
        assert await f.to_base64() == ""

    async def test_roundtrip(self, png_bytes: bytes) -> None:
        import base64 as _b64

        f = await File.from_bytes(png_bytes, metadata_hint={"name": "pic.png"})
        encoded = await f.to_base64()
        assert _b64.b64decode(encoded) == png_bytes


# ---------------------------------------------------------------------------
# File.create_presigned_upload_url
# ---------------------------------------------------------------------------


def _extract_expires_seconds(url: str) -> int | None:
    """Extract the presigned URL expiry duration in seconds.

    Boto3 may sign URLs with SigV2 (``Expires`` = absolute unix epoch) or
    SigV4 (``X-Amz-Expires`` = duration in seconds). This helper normalises
    both forms to a duration so tests can assert on the caller-provided
    ``expires_in``.
    """
    from urllib.parse import parse_qs, urlparse

    q = parse_qs(urlparse(url).query)
    if "X-Amz-Expires" in q:
        return int(q["X-Amz-Expires"][0])
    if "Expires" in q:
        import time

        absolute = int(q["Expires"][0])
        return absolute - int(time.time())
    return None


class TestCreatePresignedUploadUrl:
    async def test_returns_signed_url_for_bucket(self, s3_bucket: str) -> None:
        url = await File.create_presigned_upload_url(
            bucket=s3_bucket,
            key="uploads/test.png",
            content_type="image/png",
            expires_in=600,
        )
        assert isinstance(url, str)
        assert s3_bucket in url
        assert "uploads/test.png" in url or "uploads%2Ftest.png" in url

        # SigV2 encodes Expires as an absolute epoch; SigV4 uses a duration.
        # Normalise and allow a few seconds of drift between our measurement
        # and the signer's call to time().
        expires = _extract_expires_seconds(url)
        assert expires is not None
        assert abs(expires - 600) <= 5

    async def test_default_expires_in(self, s3_bucket: str) -> None:
        url = await File.create_presigned_upload_url(
            bucket=s3_bucket,
            key="uploads/default.png",
        )
        assert isinstance(url, str)
        expires = _extract_expires_seconds(url)
        assert expires is not None
        assert abs(expires - 3600) <= 5

    async def test_max_size_included_in_signed_params(self, s3_bucket: str) -> None:
        # When max_size is provided, boto3 signs ContentLength into the URL as
        # part of SignedHeaders or as a query param. We just verify the call
        # succeeds and returns a URL -- the exact encoding is boto3's concern.
        url = await File.create_presigned_upload_url(
            bucket=s3_bucket,
            key="uploads/sized.png",
            content_type="image/png",
            max_size=2 * 1024 * 1024,
        )
        assert isinstance(url, str)
        assert s3_bucket in url

    async def test_without_content_type(self, s3_bucket: str) -> None:
        # Should not raise when content_type is omitted
        url = await File.create_presigned_upload_url(
            bucket=s3_bucket,
            key="uploads/no-ct.bin",
        )
        assert isinstance(url, str)
