"""Parse Content-Disposition header values to extract filename and extension."""

from __future__ import annotations

import os
import re


def parse_content_disposition(header_value: str) -> tuple[str | None, str | None]:
    """Parse a Content-Disposition header to extract the filename and extension.

    Handles both simple ``filename="..."`` and RFC 5987 ``filename*=UTF-8''...`` forms.

    Args:
        header_value: The raw Content-Disposition header string.

    Returns:
        A tuple of (filename, extension). Either or both may be ``None`` if they
        cannot be determined from the header.

    Examples:
        >>> parse_content_disposition('attachment; filename="report.pdf"')
        ('report.pdf', '.pdf')
        >>> parse_content_disposition("attachment; filename*=UTF-8''my%20file.txt")
        ('my file.txt', '.txt')
    """
    if not header_value:
        return None, None

    filename: str | None = None

    # Try filename*= (RFC 5987) first -- it takes priority
    match_star = re.search(r"filename\*\s*=\s*(?:UTF-8|utf-8)?''(.+?)(?:;|$)", header_value)
    if match_star:
        from urllib.parse import unquote

        filename = unquote(match_star.group(1).strip())

    # Fall back to plain filename=
    if filename is None:
        match_plain = re.search(r'filename\s*=\s*"?([^";]+)"?', header_value, re.IGNORECASE)
        if match_plain:
            filename = match_plain.group(1).strip().strip('"')

    if filename is None:
        return None, None

    _, ext = os.path.splitext(filename)
    return filename, ext if ext else None
