"""Tests for the main File class -- from_bytes, from_file, from_url, from_stream, metadata, read/save/checksum."""

from __future__ import annotations

import os
from typing import AsyncIterator

import httpx
import pytest
import respx

from smooai_file import File, FileSource


# ---------------------------------------------------------------------------
# from_bytes
# ---------------------------------------------------------------------------


class TestFromBytes:
    async def test_basic_creation(self, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes, metadata_hint={"name": "hello.txt"})
        assert f.source == FileSource.BYTES
        assert f.name == "hello.txt"
        assert f.size == len(text_bytes)

    async def test_read_returns_same_bytes(self, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes)
        data = await f.read()
        assert data == text_bytes

    async def test_read_text(self, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes)
        text = await f.read_text()
        assert text == text_bytes.decode("utf-8")

    async def test_png_magic_detection(self, png_bytes: bytes) -> None:
        f = await File.from_bytes(png_bytes, metadata_hint={"name": "icon.png"})
        assert f.mime_type == "image/png"
        assert f.extension == "png"

    async def test_pdf_magic_detection(self, pdf_bytes: bytes) -> None:
        f = await File.from_bytes(pdf_bytes, metadata_hint={"name": "doc.pdf"})
        assert f.mime_type == "application/pdf"
        assert f.extension == "pdf"

    async def test_checksum_deterministic(self, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes)
        c1 = await f.checksum()
        c2 = await f.checksum()
        assert c1 == c2
        assert len(c1) == 64  # SHA-256 hex

    async def test_checksum_sha256(self) -> None:
        import hashlib

        data = b"\x00" * 8
        f = await File.from_bytes(data)
        expected = hashlib.sha256(data).hexdigest()
        assert await f.checksum() == expected

    async def test_metadata_hint_overrides_size(self) -> None:
        f = await File.from_bytes(b"abc", metadata_hint={"name": "x.txt"})
        # size should reflect actual bytes length (set by from_bytes)
        assert f.size == 3

    async def test_empty_bytes(self) -> None:
        f = await File.from_bytes(b"")
        assert f.size == 0
        data = await f.read()
        assert data == b""


# ---------------------------------------------------------------------------
# from_file
# ---------------------------------------------------------------------------


class TestFromFile:
    async def test_basic_creation(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert f.source == FileSource.FILE
        assert f.name == "example.txt"
        assert f.path == os.path.abspath(tmp_text_file)
        assert f.size is not None and f.size > 0

    async def test_read(self, tmp_text_file: str, text_bytes: bytes) -> None:
        f = await File.from_file(tmp_text_file)
        data = await f.read()
        assert data == text_bytes

    async def test_read_text(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        text = await f.read_text()
        assert "Hello" in text

    async def test_png_detection(self, tmp_png_file: str) -> None:
        f = await File.from_file(tmp_png_file)
        assert f.mime_type == "image/png"
        assert f.extension == "png"

    async def test_pdf_detection(self, tmp_pdf_file: str) -> None:
        f = await File.from_file(tmp_pdf_file)
        assert f.mime_type == "application/pdf"
        assert f.extension == "pdf"

    async def test_exists(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert await f.exists() is True

    async def test_is_readable(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert await f.is_readable() is True

    async def test_is_writable(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert await f.is_writable() is True

    async def test_get_stats(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        stats = await f.get_stats()
        assert stats is not None
        assert stats.st_size > 0

    async def test_last_modified(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert f.last_modified is not None

    async def test_created_at(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert f.created_at is not None

    async def test_metadata_hint_name(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file, metadata_hint={"name": "custom.txt"})
        # from_file sets name from basename, so hint "name" gets overridden by basename
        # Actually the hint is merged first, then from_file overrides with basename
        assert f.name == "example.txt"


# ---------------------------------------------------------------------------
# from_url (using respx)
# ---------------------------------------------------------------------------


class TestFromUrl:
    @respx.mock
    async def test_basic_download(self, text_bytes: bytes) -> None:
        url = "https://example.com/files/hello.txt"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={
                    "content-type": "text/plain",
                    "content-length": str(len(text_bytes)),
                    "content-disposition": 'attachment; filename="hello.txt"',
                },
            )
        )

        f = await File.from_url(url)
        assert f.source == FileSource.URL
        assert f.name == "hello.txt"
        assert f.url == url
        data = await f.read()
        assert data == text_bytes

    @respx.mock
    async def test_mime_from_headers(self, png_bytes: bytes) -> None:
        url = "https://example.com/img/photo.png"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=png_bytes,
                headers={
                    "content-type": "image/png",
                    "content-length": str(len(png_bytes)),
                },
            )
        )

        f = await File.from_url(url)
        # Magic detection overrides header for mime, but both should agree for PNG
        assert f.mime_type == "image/png"
        assert f.extension == "png"

    @respx.mock
    async def test_size_from_content_length(self, text_bytes: bytes) -> None:
        url = "https://example.com/data.bin"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={"content-length": "999"},
            )
        )

        f = await File.from_url(url)
        # content-length header says 999
        assert f.size == 999

    @respx.mock
    async def test_etag_to_hash(self, text_bytes: bytes) -> None:
        url = "https://example.com/hashtest.txt"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={"etag": '"abc123def"'},
            )
        )

        f = await File.from_url(url)
        assert f.hash == "abc123def"

    @respx.mock
    async def test_last_modified_header(self, text_bytes: bytes) -> None:
        url = "https://example.com/dated.txt"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=text_bytes,
                headers={"last-modified": "Wed, 01 Jan 2025 00:00:00 GMT"},
            )
        )

        f = await File.from_url(url)
        assert f.last_modified is not None
        assert f.last_modified.year == 2025

    @respx.mock
    async def test_metadata_hint_override(self, text_bytes: bytes) -> None:
        url = "https://example.com/file.bin"
        respx.get(url).mock(return_value=httpx.Response(200, content=text_bytes))

        f = await File.from_url(url, metadata_hint={"size": 42})
        # httpx automatically sets content-length from content, so the HTTP header
        # value overrides the hint. The size should match the actual content length.
        assert f.size == len(text_bytes)

    @respx.mock
    async def test_filename_from_url_path(self, text_bytes: bytes) -> None:
        url = "https://example.com/docs/report.pdf"
        respx.get(url).mock(return_value=httpx.Response(200, content=text_bytes))

        f = await File.from_url(url)
        # No content-disposition, should fallback to URL path
        assert f.name == "report.pdf"


# ---------------------------------------------------------------------------
# from_stream
# ---------------------------------------------------------------------------


class TestFromStream:
    async def test_async_iterator(self, text_bytes: bytes) -> None:
        async def gen() -> AsyncIterator[bytes]:
            yield text_bytes[:10]
            yield text_bytes[10:]

        f = await File.from_stream(gen())
        assert f.source == FileSource.STREAM
        data = await f.read()
        assert data == text_bytes

    async def test_sync_filelike(self, tmp_text_file: str, text_bytes: bytes) -> None:
        with open(tmp_text_file, "rb") as fh:
            f = await File.from_stream(fh)

        data = await f.read()
        assert data == text_bytes

    async def test_size_set_from_data(self, text_bytes: bytes) -> None:
        async def gen() -> AsyncIterator[bytes]:
            yield text_bytes

        f = await File.from_stream(gen())
        assert f.size == len(text_bytes)


# ---------------------------------------------------------------------------
# Metadata operations
# ---------------------------------------------------------------------------


class TestMetadata:
    async def test_set_metadata(self) -> None:
        f = await File.from_bytes(b"test", metadata_hint={"name": "orig.txt"})
        await f.set_metadata(name="new.txt", mime_type="text/plain")
        assert f.name == "new.txt"
        assert f.mime_type == "text/plain"

    async def test_str_representation(self) -> None:
        f = await File.from_bytes(b"test", metadata_hint={"name": "demo.txt"})
        s = str(f)
        assert "demo.txt" in s
        assert "Bytes" in s

    async def test_repr(self) -> None:
        f = await File.from_bytes(b"test", metadata_hint={"name": "demo.txt"})
        r = repr(f)
        assert "File(" in r
        assert "demo.txt" in r


# ---------------------------------------------------------------------------
# Save / Move / Delete
# ---------------------------------------------------------------------------


class TestSaveMoveDelete:
    async def test_save(self, tmp_text_file: str, tmp_dir: str, text_bytes: bytes) -> None:
        f = await File.from_file(tmp_text_file)
        dest = os.path.join(tmp_dir, "copy.txt")
        original, new_file = await f.save(dest)
        assert original is f
        assert new_file.source == FileSource.FILE
        assert new_file.path == os.path.abspath(dest)
        assert os.path.exists(dest)
        with open(dest, "rb") as fh:
            assert fh.read() == text_bytes

    async def test_move_from_file(self, tmp_text_file: str, tmp_dir: str, text_bytes: bytes) -> None:
        f = await File.from_file(tmp_text_file)
        dest = os.path.join(tmp_dir, "moved.txt")
        new_file = await f.move(dest)
        assert new_file.path == os.path.abspath(dest)
        assert os.path.exists(dest)
        assert not os.path.exists(tmp_text_file)

    async def test_move_from_bytes(self, tmp_dir: str, text_bytes: bytes) -> None:
        f = await File.from_bytes(text_bytes, metadata_hint={"name": "memory.txt"})
        dest = os.path.join(tmp_dir, "from_bytes.txt")
        new_file = await f.move(dest)
        assert os.path.exists(dest)
        data = await new_file.read()
        assert data == text_bytes

    async def test_delete(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert os.path.exists(tmp_text_file)
        await f.delete()
        assert not os.path.exists(tmp_text_file)

    async def test_delete_noop_for_bytes(self) -> None:
        f = await File.from_bytes(b"no-op")
        # Should not raise
        await f.delete()


# ---------------------------------------------------------------------------
# Append / Prepend / Truncate
# ---------------------------------------------------------------------------


class TestAppendPrependTruncate:
    async def test_append_string(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        await f.append(" APPENDED")
        data = await f.read_text()
        assert data.endswith(" APPENDED")

    async def test_append_bytes(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        await f.append(b"\xff")
        data = await f.read()
        assert data.endswith(b"\xff")

    async def test_prepend_string(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        await f.prepend("PREFIX ")
        data = await f.read_text()
        assert data.startswith("PREFIX ")

    async def test_truncate(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        original_size = f.size
        assert original_size is not None and original_size > 5
        await f.truncate(5)
        assert f.size == 5
        data = await f.read()
        assert len(data) == 5

    async def test_append_raises_for_non_file(self) -> None:
        f = await File.from_bytes(b"data")
        with pytest.raises(RuntimeError, match="Cannot append to non-file source"):
            await f.append("more")

    async def test_prepend_raises_for_non_file(self) -> None:
        f = await File.from_bytes(b"data")
        with pytest.raises(RuntimeError, match="Cannot prepend to non-file source"):
            await f.prepend("before")

    async def test_truncate_raises_for_non_file(self) -> None:
        f = await File.from_bytes(b"data")
        with pytest.raises(RuntimeError, match="Cannot truncate non-file source"):
            await f.truncate(1)


# ---------------------------------------------------------------------------
# Filesystem queries
# ---------------------------------------------------------------------------


class TestFilesystemQueries:
    async def test_exists_true(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        assert await f.exists() is True

    async def test_exists_after_delete(self, tmp_text_file: str) -> None:
        f = await File.from_file(tmp_text_file)
        os.remove(tmp_text_file)
        assert await f.exists() is False

    async def test_exists_bytes_source(self) -> None:
        f = await File.from_bytes(b"in memory")
        assert await f.exists() is True

    async def test_is_readable_bytes_source(self) -> None:
        f = await File.from_bytes(b"in memory")
        assert await f.is_readable() is True

    async def test_is_writable_bytes_source(self) -> None:
        f = await File.from_bytes(b"in memory")
        assert await f.is_writable() is False

    async def test_get_stats_bytes_source(self) -> None:
        f = await File.from_bytes(b"in memory")
        assert await f.get_stats() is None
