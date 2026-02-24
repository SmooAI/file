"""Main File class -- unified interface for local files, URLs, bytes, streams, and S3."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import IO, AsyncIterator, Union

import aiofiles
import aiofiles.os
import boto3
import httpx

from ._content_disposition import parse_content_disposition
from ._detection import detect_from_bytes, detect_from_extension, extension_from_mime
from ._metadata import Metadata, MetadataHint
from ._source import FileSource

logger = logging.getLogger("smooai_file")

# Type alias for content that can be appended / prepended.
ContentLike = Union[str, bytes]


def _build_s3_client():  # noqa: ANN202
    return boto3.client("s3")


class File:
    """A class representing a file with various operations and properties.

    Provides class methods to create instances from different sources (URL, bytes,
    local path, readable stream, S3) and instance methods for reading, writing,
    moving, deleting, and interacting with S3.

    The constructor is private -- use one of the ``from_*`` class methods.

    Examples:
        Create from a URL::

            file = await File.from_url("https://example.com/report.pdf")

        Create from local path::

            file = await File.from_file("/tmp/report.pdf")

        Create from S3::

            file = await File.from_s3("my-bucket", "reports/report.pdf")

        Create from bytes::

            file = await File.from_bytes(b"hello world")

        Create from an async byte-stream::

            file = await File.from_stream(my_async_iterator)
    """

    # ------------------------------------------------------------------
    # Private state
    # ------------------------------------------------------------------
    _source: FileSource
    _metadata: Metadata
    _bytes: bytes | None
    _stream: AsyncIterator[bytes] | None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def metadata(self) -> Metadata:
        return self._metadata

    @property
    def name(self) -> str | None:
        return self._metadata.name

    @property
    def mime_type(self) -> str | None:
        return self._metadata.mime_type

    @property
    def size(self) -> int | None:
        return self._metadata.size

    @property
    def extension(self) -> str | None:
        return self._metadata.extension

    @property
    def url(self) -> str | None:
        return self._metadata.url

    @property
    def path(self) -> str | None:
        return self._metadata.path

    @property
    def hash(self) -> str | None:
        return self._metadata.hash

    @property
    def last_modified(self) -> datetime | None:
        return self._metadata.last_modified

    @property
    def created_at(self) -> datetime | None:
        return self._metadata.created_at

    @property
    def source(self) -> FileSource:
        return self._source

    # ------------------------------------------------------------------
    # Construction (private)
    # ------------------------------------------------------------------
    def __init__(
        self,
        file_source: FileSource,
        metadata: Metadata,
        data: bytes | None = None,
        stream: AsyncIterator[bytes] | None = None,
    ) -> None:
        logger.info("File created: %s", metadata)
        self._source = file_source
        self._metadata = metadata
        self._bytes = data
        self._stream = stream

    def _clone(self, other: File) -> File:
        self._source = other._source
        self._metadata = other._metadata
        self._bytes = other._bytes
        self._stream = other._stream
        return self

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    async def _refresh(self) -> None:
        if self._source == FileSource.FILE and self._metadata.path:
            new = await File.from_file(self._metadata.path)
            self._clone(new)
        elif self._source == FileSource.S3 and self._metadata.url:
            bucket, key = _parse_s3_url(self._metadata.url)
            new = await File.from_s3(bucket, key)
            self._clone(new)
        elif self._source == FileSource.URL and self._metadata.url:
            new = await File.from_url(self._metadata.url)
            self._clone(new)
        elif self._source == FileSource.BYTES and self._bytes is not None:
            new = await File.from_bytes(self._bytes)
            self._clone(new)
        elif self._source == FileSource.STREAM and self._stream is not None:
            new = await File.from_stream(self._stream)
            self._clone(new)
        else:
            raise RuntimeError(f"Cannot refresh file from source: {self._source}")

    # ------------------------------------------------------------------
    # Factory: from_url
    # ------------------------------------------------------------------
    @classmethod
    async def from_url(cls, url: str, metadata_hint: MetadataHint | None = None) -> File:
        """Create a File from a URL.

        Args:
            url: The URL to download.
            metadata_hint: Optional metadata hints to override/seed detection.

        Returns:
            A new ``File`` instance.
        """
        hint: MetadataHint = {**(metadata_hint or {}), "url": url}

        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.content

        metadata = await cls._build_metadata(
            file_source=FileSource.URL,
            metadata_hint=hint,
            http_response=response,
            data=data,
        )
        return cls(FileSource.URL, metadata, data=data)

    # ------------------------------------------------------------------
    # Factory: from_bytes
    # ------------------------------------------------------------------
    @classmethod
    async def from_bytes(cls, data: bytes | bytearray | memoryview, metadata_hint: MetadataHint | None = None) -> File:
        """Create a File from raw bytes.

        Args:
            data: The file content as bytes-like object.
            metadata_hint: Optional metadata hints.

        Returns:
            A new ``File`` instance.
        """
        raw = bytes(data)
        hint: MetadataHint = {**(metadata_hint or {}), "size": len(raw)}

        metadata = await cls._build_metadata(
            file_source=FileSource.BYTES,
            metadata_hint=hint,
            data=raw,
        )
        return cls(FileSource.BYTES, metadata, data=raw)

    # ------------------------------------------------------------------
    # Factory: from_file
    # ------------------------------------------------------------------
    @classmethod
    async def from_file(cls, file_path: str, metadata_hint: MetadataHint | None = None) -> File:
        """Create a File from a local filesystem path.

        Args:
            file_path: Absolute or relative path to the file.
            metadata_hint: Optional metadata hints.

        Returns:
            A new ``File`` instance.
        """
        abs_path = os.path.abspath(file_path)
        hint: MetadataHint = {
            **(metadata_hint or {}),
            "path": abs_path,
            "name": os.path.basename(abs_path),
        }

        async with aiofiles.open(abs_path, "rb") as f:
            data = await f.read()

        metadata = await cls._build_metadata(
            file_source=FileSource.FILE,
            metadata_hint=hint,
            data=data,
        )
        return cls(FileSource.FILE, metadata, data=data)

    # ------------------------------------------------------------------
    # Factory: from_stream
    # ------------------------------------------------------------------
    @classmethod
    async def from_stream(
        cls,
        stream: AsyncIterator[bytes] | IO[bytes],
        metadata_hint: MetadataHint | None = None,
    ) -> File:
        """Create a File from an async byte-stream or sync file-like object.

        The entire stream is consumed into memory so that magic-byte detection
        and other operations can work.

        Args:
            stream: An async iterator yielding ``bytes`` chunks, or a sync
                file-like object with a ``read()`` method.
            metadata_hint: Optional metadata hints.

        Returns:
            A new ``File`` instance.
        """
        chunks: list[bytes] = []
        if hasattr(stream, "__aiter__"):
            async for chunk in stream:  # type: ignore[union-attr]
                chunks.append(chunk)
        elif hasattr(stream, "read"):
            # Synchronous file-like object
            while True:
                chunk = stream.read(65536)  # type: ignore[union-attr]
                if not chunk:
                    break
                chunks.append(chunk)
        else:
            raise TypeError("stream must be an async iterator or a file-like object with read()")

        data = b"".join(chunks)
        hint: MetadataHint = {**(metadata_hint or {}), "size": len(data)}

        metadata = await cls._build_metadata(
            file_source=FileSource.STREAM,
            metadata_hint=hint,
            data=data,
        )
        return cls(FileSource.STREAM, metadata, data=data)

    # ------------------------------------------------------------------
    # Factory: from_s3
    # ------------------------------------------------------------------
    @classmethod
    async def from_s3(cls, bucket: str, key: str, metadata_hint: MetadataHint | None = None) -> File:
        """Create a File from an S3 object.

        Args:
            bucket: The S3 bucket name.
            key: The S3 object key.
            metadata_hint: Optional metadata hints.

        Returns:
            A new ``File`` instance.

        Raises:
            RuntimeError: If the S3 response body is missing.
        """
        s3 = _build_s3_client()
        response = s3.get_object(Bucket=bucket, Key=key)

        body = response.get("Body")
        if body is None:
            raise RuntimeError("Response body is missing")

        data = body.read()

        hint: MetadataHint = {
            **(metadata_hint or {}),
            "url": f"s3://{bucket}/{key}",
            "name": os.path.basename(key),
        }

        metadata = await cls._build_metadata(
            file_source=FileSource.S3,
            metadata_hint=hint,
            data=data,
            s3_response=response,
        )
        return cls(FileSource.S3, metadata, data=data)

    # ------------------------------------------------------------------
    # Metadata pipeline
    # ------------------------------------------------------------------
    @classmethod
    async def _build_metadata(
        cls,
        *,
        file_source: FileSource,
        metadata_hint: MetadataHint | None = None,
        http_response: httpx.Response | None = None,
        s3_response: dict | None = None,
        data: bytes | None = None,
    ) -> Metadata:
        """Build metadata using the priority cascade: hint -> headers/S3 -> stat -> magic -> ext."""
        hint = metadata_hint or {}

        name: str | None = hint.get("name")
        extension: str | None = hint.get("extension")
        mime_type: str | None = hint.get("mime_type")
        size: int | None = hint.get("size")
        file_hash: str | None = hint.get("hash")
        last_modified: datetime | None = hint.get("last_modified")
        created_at: datetime | None = hint.get("created_at")
        file_path: str | None = hint.get("path")
        url: str | None = hint.get("url")

        # Also check if hint carries a response object
        if http_response is None:
            http_response = hint.get("response")

        # ------ HTTP response headers ------
        if http_response is not None:
            headers = http_response.headers

            cd = headers.get("content-disposition")
            if cd:
                cd_name, _cd_ext = parse_content_disposition(cd)
                if cd_name:
                    name = cd_name
            if name is None:
                name = _filename_from_url(url)

            ct = headers.get("content-type")
            cl = headers.get("content-length")
            etag = headers.get("etag")
            lm = headers.get("last-modified")
            cmd5 = headers.get("content-md5")

            if cl is not None:
                try:
                    size = int(cl)
                except ValueError:
                    pass

            if ct:
                mime_type = ct
            elif name:
                ext_mime, _ = detect_from_extension(name)
                if ext_mime:
                    mime_type = ext_mime

            if etag:
                file_hash = etag.strip('"')
            elif cmd5:
                file_hash = cmd5

            if lm:
                try:
                    last_modified = _parse_http_date(lm)
                except Exception:
                    pass

            logger.debug(
                "Metadata from HTTP headers: name=%s size=%s mime=%s hash=%s last_modified=%s",
                name,
                size,
                mime_type,
                file_hash,
                last_modified,
            )

        # ------ S3 response metadata ------
        if s3_response is not None:
            s3_cd = s3_response.get("ContentDisposition")
            if s3_cd:
                cd_name, _cd_ext = parse_content_disposition(s3_cd)
                if cd_name:
                    name = cd_name

            s3_ct = s3_response.get("ContentType")
            s3_cl = s3_response.get("ContentLength")
            s3_etag = s3_response.get("ETag")
            s3_lm = s3_response.get("LastModified")

            if s3_cl is not None:
                try:
                    size = int(s3_cl)
                except (ValueError, TypeError):
                    pass

            if s3_ct:
                mime_type = s3_ct
            elif name:
                ext_mime, _ = detect_from_extension(name)
                if ext_mime:
                    mime_type = ext_mime

            if s3_etag:
                file_hash = s3_etag.strip('"')

            if s3_lm:
                if isinstance(s3_lm, datetime):
                    last_modified = s3_lm
                else:
                    try:
                        last_modified = _parse_http_date(str(s3_lm))
                    except Exception:
                        pass

            logger.debug(
                "Metadata from S3 response: name=%s size=%s mime=%s hash=%s last_modified=%s",
                name,
                size,
                mime_type,
                file_hash,
                last_modified,
            )

        # ------ File system stat ------
        if file_source == FileSource.FILE and file_path:
            try:
                stat = os.stat(file_path)
                size = stat.st_size
                last_modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                created_at = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
            except OSError:
                pass

            # Detect from file extension on disk
            ext_mime, _ = detect_from_extension(file_path)
            if ext_mime:
                mime_type = ext_mime

            logger.debug(
                "Metadata from filesystem: mime=%s size=%s last_modified=%s created_at=%s",
                mime_type,
                size,
                last_modified,
                created_at,
            )

        # ------ Name-based MIME fallback ------
        if not mime_type and name:
            ext_mime, _ = detect_from_extension(name)
            if ext_mime:
                mime_type = ext_mime
            logger.debug("MIME from filename: %s", mime_type)

        # ------ Magic-byte detection ------
        if data:
            magic_mime, magic_ext = detect_from_bytes(data)
            if magic_mime:
                mime_type = magic_mime
            if magic_ext:
                # Normalise: ensure leading dot
                extension = magic_ext if magic_ext.startswith(".") else f".{magic_ext}"
            logger.debug("MIME from magic bytes: mime=%s ext=%s", magic_mime, magic_ext)

        # ------ Extension fallback from MIME ------
        if not extension and mime_type:
            ext = extension_from_mime(mime_type)
            if ext:
                extension = ext

        # Normalise extension: strip leading dot for storage consistency with TS version
        if extension and extension.startswith("."):
            extension = extension[1:]

        return Metadata(
            name=name,
            mime_type=mime_type,
            size=size,
            extension=extension,
            url=url,
            path=file_path,
            hash=file_hash,
            last_modified=last_modified,
            created_at=created_at,
        )

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------
    async def read(self) -> bytes:
        """Read the file contents as bytes.

        Returns:
            The raw file content.
        """
        if self._bytes is not None:
            return self._bytes

        if self._stream is not None:
            chunks: list[bytes] = []
            if hasattr(self._stream, "__aiter__"):
                async for chunk in self._stream:
                    chunks.append(chunk)
            self._bytes = b"".join(chunks)
            return self._bytes

        return b""

    async def read_text(self, encoding: str = "utf-8") -> str:
        """Read the file contents as a string.

        Args:
            encoding: The text encoding to use (default ``utf-8``).

        Returns:
            The file content decoded as text.
        """
        data = await self.read()
        return data.decode(encoding)

    # ------------------------------------------------------------------
    # Save / Move / Delete
    # ------------------------------------------------------------------
    async def save(self, destination_path: str) -> tuple[File, File]:
        """Save (copy) the file to a new filesystem location.

        Args:
            destination_path: Where to write the file.

        Returns:
            A tuple ``(original, new_file)`` where ``new_file`` is a fresh
            ``File`` instance pointing at the destination.
        """
        data = await self.read()
        async with aiofiles.open(destination_path, "wb") as f:
            await f.write(data)
        new_file = await File.from_file(destination_path)
        return self, new_file

    async def move(self, destination_path: str) -> File:
        """Move the file to a new filesystem location.

        If the source is a local file, the original is deleted after copying.

        Args:
            destination_path: The new path.

        Returns:
            A new ``File`` instance at the destination.
        """
        _, new_file = await self.save(destination_path)
        if self._source == FileSource.FILE and self._metadata.path:
            await aiofiles.os.remove(self._metadata.path)
        return new_file

    async def delete(self) -> None:
        """Delete the file from the filesystem.

        Only works for files created with ``from_file``.
        """
        if self._source == FileSource.FILE and self._metadata.path:
            await aiofiles.os.remove(self._metadata.path)

    # ------------------------------------------------------------------
    # Checksum
    # ------------------------------------------------------------------
    async def checksum(self, algorithm: str = "sha256") -> str:
        """Calculate a hex-digest checksum of the file content.

        Args:
            algorithm: Hash algorithm name (default ``sha256``).

        Returns:
            The hex-encoded digest string.
        """
        data = await self.read()
        h = hashlib.new(algorithm)
        h.update(data)
        return h.hexdigest()

    # ------------------------------------------------------------------
    # S3 operations
    # ------------------------------------------------------------------
    async def upload_to_s3(self, bucket: str, key: str) -> None:
        """Upload the file to an S3 bucket.

        Args:
            bucket: The S3 bucket name.
            key: The S3 object key.
        """
        data = await self.read()
        s3 = _build_s3_client()

        extra: dict = {}
        if self._metadata.mime_type:
            extra["ContentType"] = self._metadata.mime_type
        if self._metadata.size is not None:
            extra["ContentLength"] = self._metadata.size
        if self._metadata.name:
            extra["ContentDisposition"] = f'attachment; filename="{self._metadata.name}"'

        s3.put_object(Bucket=bucket, Key=key, Body=data, **extra)

    async def save_to_s3(self, bucket: str, key: str) -> tuple[File, File]:
        """Upload to S3 and return both the original and a new S3-backed File.

        Args:
            bucket: The S3 bucket name.
            key: The S3 object key.

        Returns:
            A tuple ``(original, new_file)``.
        """
        await self.upload_to_s3(bucket, key)
        new_file = await File.from_s3(bucket, key)
        return self, new_file

    async def move_to_s3(self, bucket: str, key: str) -> File:
        """Upload to S3, delete local source if applicable, return new S3 File.

        Args:
            bucket: The S3 bucket name.
            key: The S3 object key.

        Returns:
            A new ``File`` instance backed by S3.
        """
        await self.upload_to_s3(bucket, key)
        if self._source == FileSource.FILE and self._metadata.path:
            await aiofiles.os.remove(self._metadata.path)
        return await File.from_s3(bucket, key)

    async def download_from_s3(self, bucket: str, key: str, destination_path: str) -> File:
        """Download an S3 object to a local file and return a new File.

        This is a convenience method -- you can also use ``File.from_s3`` followed
        by ``save()``.

        Args:
            bucket: The S3 bucket name.
            key: The S3 object key.
            destination_path: Local path to write the downloaded content.

        Returns:
            A new ``File`` instance pointing at the local path.
        """
        s3_file = await File.from_s3(bucket, key)
        _, local_file = await s3_file.save(destination_path)
        return local_file

    async def get_signed_url(self, expires_in: int = 3600) -> str:
        """Generate a pre-signed URL for an S3-backed file.

        Args:
            expires_in: Seconds until the URL expires (default 3600).

        Returns:
            The pre-signed URL string.

        Raises:
            RuntimeError: If the file is not S3-backed.
        """
        if self._source != FileSource.S3 or not self._metadata.url:
            raise RuntimeError("Cannot generate signed URL for non-S3 file")

        bucket, key = _parse_s3_url(self._metadata.url)
        s3 = _build_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    # ------------------------------------------------------------------
    # Append / Prepend / Truncate (file-source only)
    # ------------------------------------------------------------------
    async def append(self, content: ContentLike) -> None:
        """Append content to the end of a local file.

        Args:
            content: String or bytes to append.

        Raises:
            RuntimeError: If the file is not a local-file source.
        """
        if self._source != FileSource.FILE or not self._metadata.path:
            raise RuntimeError("Cannot append to non-file source")

        raw = content.encode("utf-8") if isinstance(content, str) else content
        async with aiofiles.open(self._metadata.path, "ab") as f:
            await f.write(raw)
        await self._refresh()

    async def prepend(self, content: ContentLike) -> None:
        """Prepend content to the beginning of a local file.

        Args:
            content: String or bytes to prepend.

        Raises:
            RuntimeError: If the file is not a local-file source.
        """
        if self._source != FileSource.FILE or not self._metadata.path:
            raise RuntimeError("Cannot prepend to non-file source")

        existing = await self.read()
        raw = content.encode("utf-8") if isinstance(content, str) else content
        async with aiofiles.open(self._metadata.path, "wb") as f:
            await f.write(raw + existing)
        await self._refresh()

    async def truncate(self, size: int) -> None:
        """Truncate a local file to the given size.

        Args:
            size: The desired file size in bytes.

        Raises:
            RuntimeError: If the file is not a local-file source.
        """
        if self._source != FileSource.FILE or not self._metadata.path:
            raise RuntimeError("Cannot truncate non-file source")

        async with aiofiles.open(self._metadata.path, "r+b") as f:
            await f.truncate(size)
        await self._refresh()

    # ------------------------------------------------------------------
    # Filesystem queries
    # ------------------------------------------------------------------
    async def exists(self) -> bool:
        """Check whether the underlying file exists on disk.

        For non-file sources, returns ``True`` (data is in memory).
        """
        if self._source == FileSource.FILE and self._metadata.path:
            return os.path.exists(self._metadata.path)
        return True

    async def is_readable(self) -> bool:
        """Check whether the underlying file is readable.

        For non-file sources, returns ``True``.
        """
        if self._source == FileSource.FILE and self._metadata.path:
            return os.access(self._metadata.path, os.R_OK)
        return True

    async def is_writable(self) -> bool:
        """Check whether the underlying file is writable.

        For non-file sources, returns ``False``.
        """
        if self._source == FileSource.FILE and self._metadata.path:
            return os.access(self._metadata.path, os.W_OK)
        return False

    async def get_stats(self) -> os.stat_result | None:
        """Return the ``os.stat_result`` for a local file, or ``None``."""
        if self._source == FileSource.FILE and self._metadata.path:
            return os.stat(self._metadata.path)
        return None

    # ------------------------------------------------------------------
    # Metadata update
    # ------------------------------------------------------------------
    async def set_metadata(self, **kwargs: object) -> None:
        """Update metadata fields.

        Accepts any keyword argument matching a ``Metadata`` field name.

        Examples:
            >>> await file.set_metadata(name="new-name.txt", mime_type="text/plain")
        """
        for k, v in kwargs.items():
            if hasattr(self._metadata, k):
                setattr(self._metadata, k, v)

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------
    def __str__(self) -> str:
        return json.dumps(
            {
                "name": self._metadata.name,
                "mime_type": self._metadata.mime_type,
                "size": self._metadata.size,
                "extension": self._metadata.extension,
                "url": self._metadata.url,
                "path": self._metadata.path,
                "hash": self._metadata.hash,
                "last_modified": self._metadata.last_modified.isoformat() if self._metadata.last_modified else None,
                "created_at": self._metadata.created_at.isoformat() if self._metadata.created_at else None,
                "source": self._source.value,
            }
        )

    def __repr__(self) -> str:
        return f"File(source={self._source.value!r}, name={self._metadata.name!r}, mime_type={self._metadata.mime_type!r}, size={self._metadata.size!r})"


# ------------------------------------------------------------------
# Module-private helpers
# ------------------------------------------------------------------


def _parse_s3_url(url: str) -> tuple[str, str]:
    """Parse ``s3://bucket/key`` into ``(bucket, key)``."""
    stripped = url.replace("s3://", "", 1)
    parts = stripped.split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid S3 URL: {url}")
    return parts[0], parts[1]


def _filename_from_url(url: str | None) -> str | None:
    """Extract a filename from a URL path, or ``None``."""
    if not url:
        return None
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        basename = os.path.basename(parsed.path)
        return basename if basename and basename != "/" else None
    except Exception:
        return None


def _parse_http_date(date_str: str) -> datetime:
    """Parse an HTTP-date (RFC 7231) string into a ``datetime``."""
    from email.utils import parsedate_to_datetime

    return parsedate_to_datetime(date_str)
