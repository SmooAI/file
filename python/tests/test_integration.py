"""Integration tests -- full pipelines combining multiple operations."""

from __future__ import annotations

import os
from typing import AsyncIterator

import httpx
import respx

from smooai_file import File, FileSource


class TestUrlToFile:
    """Download from URL, save to disk, verify."""

    @respx.mock
    async def test_download_and_save(self, tmp_dir: str, text_bytes: bytes) -> None:
        url = "https://example.com/report.txt"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={
                    "content-type": "text/plain",
                    "content-disposition": 'attachment; filename="report.txt"',
                },
            )
        )

        f = await File.from_url(url)
        assert f.source == FileSource.URL
        assert f.name == "report.txt"

        dest = os.path.join(tmp_dir, "saved_report.txt")
        original, saved = await f.save(dest)

        assert original is f
        assert saved.source == FileSource.FILE
        assert saved.path == os.path.abspath(dest)
        assert os.path.exists(dest)

        saved_data = await saved.read()
        assert saved_data == text_bytes


class TestFileToBytesRoundTrip:
    """Read a file, get bytes, create from bytes, verify identical."""

    async def test_roundtrip(self, tmp_text_file: str, text_bytes: bytes) -> None:
        f1 = await File.from_file(tmp_text_file)
        data = await f1.read()
        assert data == text_bytes

        f2 = await File.from_bytes(data, metadata_hint={"name": "roundtrip.txt"})
        assert await f2.read() == text_bytes
        assert f2.name == "roundtrip.txt"


class TestFileToS3RoundTrip:
    """Upload a file to S3, download it, verify identical."""

    async def test_roundtrip(
        self,
        s3_bucket: str,
        tmp_text_file: str,
        tmp_dir: str,
        text_bytes: bytes,
    ) -> None:
        # 1. Load from disk
        f1 = await File.from_file(tmp_text_file)
        assert f1.source == FileSource.FILE

        # 2. Upload to S3
        original, s3_file = await f1.save_to_s3(s3_bucket, "roundtrip/test.txt")
        assert s3_file.source == FileSource.S3
        assert s3_file.url == f"s3://{s3_bucket}/roundtrip/test.txt"

        # 3. Download from S3 back to disk
        dest = os.path.join(tmp_dir, "roundtrip_back.txt")
        local_file = await s3_file.download_from_s3(s3_bucket, "roundtrip/test.txt", dest)
        assert local_file.source == FileSource.FILE

        # 4. Verify content identical
        final_data = await local_file.read()
        assert final_data == text_bytes


class TestStreamThroughPipeline:
    """Create from async stream -> save to disk -> upload to S3 -> verify."""

    async def test_stream_to_s3(self, s3_bucket: str, tmp_dir: str, text_bytes: bytes) -> None:
        async def gen() -> AsyncIterator[bytes]:
            for i in range(0, len(text_bytes), 10):
                yield text_bytes[i : i + 10]

        # 1. Create from stream
        f = await File.from_stream(gen(), metadata_hint={"name": "stream.txt"})
        assert f.source == FileSource.STREAM
        stream_data = await f.read()
        assert stream_data == text_bytes

        # 2. Save to disk
        disk_path = os.path.join(tmp_dir, "streamed.txt")
        _, disk_file = await f.save(disk_path)
        assert os.path.exists(disk_path)

        # 3. Upload to S3
        _, s3_file = await disk_file.save_to_s3(s3_bucket, "streamed/file.txt")
        assert s3_file.source == FileSource.S3

        # 4. Verify
        s3_data = await s3_file.read()
        assert s3_data == text_bytes


class TestMoveChain:
    """Move file -> move again -> verify only final location exists."""

    async def test_chain(self, tmp_text_file: str, tmp_dir: str) -> None:
        f = await File.from_file(tmp_text_file)
        path1 = os.path.join(tmp_dir, "step1.txt")
        path2 = os.path.join(tmp_dir, "step2.txt")

        f2 = await f.move(path1)
        assert os.path.exists(path1)
        assert not os.path.exists(tmp_text_file)

        f3 = await f2.move(path2)
        assert os.path.exists(path2)
        assert not os.path.exists(path1)

        data = await f3.read()
        assert len(data) > 0


class TestAppendPrependPipeline:
    """Append and prepend to a file, then verify the full content."""

    async def test_append_prepend(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        await f.prepend("HEADER\n")
        await f.append("\nFOOTER")

        text = await f.read_text()
        assert text.startswith("HEADER\n")
        assert text.endswith("\nFOOTER")


class TestChecksumConsistency:
    """Verify checksum is consistent across different creation methods."""

    async def test_bytes_vs_file(self, tmp_dir: str, text_bytes: bytes) -> None:
        # From bytes
        fb = await File.from_bytes(text_bytes)
        ckb = await fb.checksum()

        # Save to disk, then from file
        path = os.path.join(tmp_dir, "cksum.txt")
        _, ff = await fb.save(path)
        ckf = await ff.checksum()

        assert ckb == ckf

    async def test_consistent_across_reads(self) -> None:
        f = await File.from_bytes(b"stable content")
        c1 = await f.checksum()
        c2 = await f.checksum()
        c3 = await f.checksum()
        assert c1 == c2 == c3


class TestMetadataPreservation:
    """Metadata should be preserved through save operations."""

    @respx.mock
    async def test_url_metadata_after_save(self, tmp_dir: str, text_bytes: bytes) -> None:
        url = "https://cdn.example.com/assets/logo.txt"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={
                    "content-type": "text/plain",
                    "content-length": str(len(text_bytes)),
                    "etag": '"hash123"',
                },
            )
        )

        f = await File.from_url(url)
        assert f.hash == "hash123"

        dest = os.path.join(tmp_dir, "preserved.txt")
        original, saved = await f.save(dest)

        # Original should still have hash from URL
        assert original.hash == "hash123"
        # New file from disk will have different metadata (from stat)
        assert saved.source == FileSource.FILE
