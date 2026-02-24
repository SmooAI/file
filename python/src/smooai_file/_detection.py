"""MIME type and extension detection utilities using puremagic and mimetypes."""

from __future__ import annotations

import mimetypes
import os

import puremagic


def detect_from_bytes(data: bytes) -> tuple[str | None, str | None]:
    """Detect MIME type and extension from raw bytes using magic number signatures.

    Uses ``puremagic`` to inspect the leading bytes of the data.

    Args:
        data: The raw file content (at least the first few hundred bytes).

    Returns:
        A tuple of (mime_type, extension). Either may be ``None`` if detection fails.
        The extension includes the leading dot (e.g. ``".png"``).
    """
    if not data:
        return None, None

    try:
        matches = puremagic.magic_string(data)
        if matches:
            # puremagic returns a list; take the first (highest confidence) match
            best = matches[0]
            mime_type: str | None = best.mime_type if best.mime_type else None
            extension: str | None = best.extension if best.extension else None
            return mime_type, extension
    except puremagic.PureError:
        pass

    return None, None


def detect_from_extension(filename: str) -> tuple[str | None, str | None]:
    """Detect MIME type from a filename's extension using the ``mimetypes`` stdlib module.

    Args:
        filename: A filename or path (e.g. ``"report.pdf"``).

    Returns:
        A tuple of (mime_type, extension). Either may be ``None`` if detection fails.
        The extension includes the leading dot (e.g. ``".pdf"``).
    """
    if not filename:
        return None, None

    mime_type, _ = mimetypes.guess_type(filename)
    _, ext = os.path.splitext(filename)
    return mime_type, ext if ext else None


def extension_from_mime(mime_type: str) -> str | None:
    """Guess a file extension from a MIME type.

    Args:
        mime_type: A MIME type string (e.g. ``"application/pdf"``).

    Returns:
        An extension including the leading dot (e.g. ``".pdf"``), or ``None``.
    """
    if not mime_type:
        return None
    ext = mimetypes.guess_extension(mime_type)
    return ext
