"""FileSource enum for identifying the origin of a File."""

from enum import Enum


class FileSource(str, Enum):
    """Enumeration of possible file sources.

    Examples:
        >>> source = FileSource.URL
        >>> source = FileSource.BYTES
        >>> source = FileSource.FILE
        >>> source = FileSource.STREAM
        >>> source = FileSource.S3
    """

    URL = "Url"
    BYTES = "Bytes"
    FILE = "File"
    STREAM = "Stream"
    S3 = "S3"
