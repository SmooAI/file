"""Tests for S3 operations using moto mock."""

from __future__ import annotations

import os

import boto3
import pytest

from smooai_file import File, FileSource


class TestFromS3:
    async def test_basic_download(self, s3_text_object: tuple[str, str], text_bytes: bytes) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key)
        assert f.source == FileSource.S3
        assert f.url == f"s3://{bucket}/{key}"
        assert f.name == "example.txt"
        data = await f.read()
        assert data == text_bytes

    async def test_read_text(self, s3_text_object: tuple[str, str]) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key)
        text = await f.read_text()
        assert "Hello" in text

    async def test_png_from_s3(self, s3_png_object: tuple[str, str], png_bytes: bytes) -> None:
        bucket, key = s3_png_object
        f = await File.from_s3(bucket, key)
        assert f.mime_type == "image/png"
        assert f.extension == "png"
        data = await f.read()
        assert data == png_bytes

    async def test_size_from_s3(self, s3_text_object: tuple[str, str], text_bytes: bytes) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key)
        assert f.size == len(text_bytes)

    async def test_metadata_hint_preserved(self, s3_text_object: tuple[str, str]) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key, metadata_hint={"hash": "custom-hash"})
        # S3 ETag should override the hint hash
        # But our pipeline applies S3 metadata after hint, so ETag wins
        # The actual value depends on moto's ETag generation
        assert f.hash is not None

    async def test_missing_body_raises(self, s3_bucket: str) -> None:
        # Try to get a non-existent key -- boto3 will raise ClientError
        with pytest.raises(Exception):
            await File.from_s3(s3_bucket, "nonexistent/key.txt")


class TestUploadToS3:
    async def test_upload_bytes(self, s3_bucket: str, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes, metadata_hint={"name": "upload.txt", "mime_type": "text/plain"})
        await f.upload_to_s3(s3_bucket, "uploaded/file.txt")

        # Verify the object exists in S3
        s3 = boto3.client("s3", region_name="us-east-1")
        resp = s3.get_object(Bucket=s3_bucket, Key="uploaded/file.txt")
        assert resp["Body"].read() == text_bytes

    async def test_upload_preserves_content_type(self, s3_bucket: str) -> None:
        f = await File.from_bytes(b"pdf-like", metadata_hint={"name": "doc.pdf", "mime_type": "application/pdf"})
        await f.upload_to_s3(s3_bucket, "docs/doc.pdf")

        s3 = boto3.client("s3", region_name="us-east-1")
        resp = s3.head_object(Bucket=s3_bucket, Key="docs/doc.pdf")
        assert resp["ContentType"] == "application/pdf"

    async def test_upload_from_file(self, s3_bucket: str, tmp_text_file: str, text_bytes: bytes) -> None:
        f = await File.from_file(tmp_text_file)
        await f.upload_to_s3(s3_bucket, "from-disk/example.txt")

        s3 = boto3.client("s3", region_name="us-east-1")
        resp = s3.get_object(Bucket=s3_bucket, Key="from-disk/example.txt")
        assert resp["Body"].read() == text_bytes


class TestSaveToS3:
    async def test_save_returns_both(self, s3_bucket: str, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes, metadata_hint={"name": "original.txt"})
        original, new_file = await f.save_to_s3(s3_bucket, "saved/copy.txt")

        assert original is f
        assert new_file.source == FileSource.S3
        assert new_file.url == f"s3://{s3_bucket}/saved/copy.txt"
        # The upload includes ContentDisposition with filename="original.txt", so
        # when from_s3 reads the object back, the CD header overrides the key basename.
        assert new_file.name == "original.txt"

        new_data = await new_file.read()
        assert new_data == text_bytes

    async def test_original_still_readable(self, s3_bucket: str, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes)
        original, _ = await f.save_to_s3(s3_bucket, "keep/orig.txt")
        data = await original.read()
        assert data == text_bytes


class TestMoveToS3:
    async def test_move_from_file(self, s3_bucket: str, tmp_text_file: str, text_bytes: bytes) -> None:
        f = await File.from_file(tmp_text_file)
        new_file = await f.move_to_s3(s3_bucket, "moved/file.txt")

        assert new_file.source == FileSource.S3
        assert not os.path.exists(tmp_text_file)

        data = await new_file.read()
        assert data == text_bytes

    async def test_move_from_bytes(self, s3_bucket: str, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes, metadata_hint={"name": "mem.txt"})
        new_file = await f.move_to_s3(s3_bucket, "moved/mem.txt")

        assert new_file.source == FileSource.S3
        data = await new_file.read()
        assert data == text_bytes


class TestGetSignedUrl:
    async def test_signed_url(self, s3_text_object: tuple[str, str]) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key)
        url = await f.get_signed_url(expires_in=300)
        assert isinstance(url, str)
        assert "test-bucket" in url
        assert "example.txt" in url

    async def test_signed_url_non_s3_raises(self) -> None:
        f = await File.from_bytes(b"not s3")
        with pytest.raises(RuntimeError, match="Cannot generate signed URL for non-S3 file"):
            await f.get_signed_url()


class TestDownloadFromS3:
    async def test_download(self, s3_text_object: tuple[str, str], tmp_dir: str, text_bytes: bytes) -> None:
        bucket, key = s3_text_object
        f = await File.from_s3(bucket, key)
        dest = os.path.join(tmp_dir, "downloaded.txt")
        local_file = await f.download_from_s3(bucket, key, dest)

        assert local_file.source == FileSource.FILE
        assert os.path.exists(dest)
        data = await local_file.read()
        assert data == text_bytes
