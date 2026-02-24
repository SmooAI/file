"""Metadata dataclass and MetadataHint TypedDict for file metadata."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict

import httpx


class MetadataHint(TypedDict, total=False):
    """A partial set of metadata properties that can be used as hints when creating a file.

    Examples:
        >>> hint: MetadataHint = {"name": "document.pdf", "mime_type": "application/pdf"}
    """

    name: str | None
    mime_type: str | None
    size: int | None
    extension: str | None
    url: str | None
    path: str | None
    hash: str | None
    last_modified: datetime | None
    created_at: datetime | None
    response: httpx.Response | None


@dataclass
class Metadata:
    """Represents metadata about a file including its properties and attributes.

    Examples:
        >>> metadata = Metadata(
        ...     name="example.txt",
        ...     mime_type="text/plain",
        ...     size=1024,
        ...     extension="txt",
        ...     url="https://example.com/file.txt",
        ...     path="/path/to/file.txt",
        ... )
    """

    name: str | None = field(default=None)
    mime_type: str | None = field(default=None)
    size: int | None = field(default=None)
    extension: str | None = field(default=None)
    url: str | None = field(default=None)
    path: str | None = field(default=None)
    hash: str | None = field(default=None)
    last_modified: datetime | None = field(default=None)
    created_at: datetime | None = field(default=None)
