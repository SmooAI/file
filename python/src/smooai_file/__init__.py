"""Smoo AI File Library - Python SDK.

A unified file handling library for working with files from local filesystem,
S3, URLs, and streams.
"""

__version__ = "1.1.5"

from ._content_disposition import parse_content_disposition
from ._detection import detect_from_bytes, detect_from_extension, extension_from_mime
from ._file import File
from ._metadata import Metadata, MetadataHint
from ._source import FileSource

__all__ = [
    "File",
    "FileSource",
    "Metadata",
    "MetadataHint",
    "detect_from_bytes",
    "detect_from_extension",
    "extension_from_mime",
    "parse_content_disposition",
]
