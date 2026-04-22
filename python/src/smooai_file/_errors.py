"""Typed error hierarchy for file validation failures.

Consumers can ``except FileValidationError`` to uniformly map validation
failures to an HTTP 400 (or similar boundary response) without parsing
error messages.
"""

from __future__ import annotations

from collections.abc import Sequence


class FileValidationError(Exception):
    """Base class for all file validation errors.

    Consumers can ``except FileValidationError`` to uniformly map validation
    failures to an HTTP 400 or similar boundary response.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class FileSizeError(FileValidationError):
    """Raised when a file exceeds the declared ``max_size`` during validation."""

    def __init__(self, actual_size: int | None, max_size: int) -> None:
        self.actual_size = actual_size
        self.max_size = max_size
        if actual_size is None:
            message = f"File size is unknown; max_size is {max_size} bytes"
        else:
            message = f"File size ({actual_size} bytes) exceeds maximum allowed ({max_size} bytes)"
        super().__init__(message)


class FileMimeError(FileValidationError):
    """Raised when a file's mime type is not in the declared ``allowed_mimes`` list."""

    def __init__(self, actual_mime_type: str | None, allowed_mimes: Sequence[str]) -> None:
        self.actual_mime_type = actual_mime_type
        self.allowed_mimes = tuple(allowed_mimes)
        allowed_str = ", ".join(self.allowed_mimes)
        if actual_mime_type:
            message = f'File mime type "{actual_mime_type}" is not in the allowed list: {allowed_str}'
        else:
            message = f"File mime type is unknown; allowed types are: {allowed_str}"
        super().__init__(message)


class FileContentMismatchError(FileValidationError):
    """Raised when the magic-byte-detected mime type does not match the claimed mime type.

    This is the primary defense against mime-spoofing attacks for user uploads
    (e.g. a ``.php`` file uploaded with ``Content-Type: image/png``).
    """

    def __init__(self, claimed_mime_type: str | None, detected_mime_type: str | None) -> None:
        self.claimed_mime_type = claimed_mime_type
        self.detected_mime_type = detected_mime_type
        claimed = claimed_mime_type if claimed_mime_type is not None else "unknown"
        detected = detected_mime_type if detected_mime_type is not None else "unknown"
        super().__init__(f"File content does not match claimed mime type. Claimed: {claimed}, detected: {detected}")
