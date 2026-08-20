"""The Python loader for the shared error taxonomy.

Every port has one of these and they all read the SAME file
(``spec/error-taxonomy.json``). Copying the ``kind`` values into this module
instead is the drift the fixture exists to stop.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from smooai_file import (
    FileContentMismatchError,
    FileMimeError,
    FileSizeError,
    FileValidationError,
    FileValidationKind,
)

_TAXONOMY: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "error-taxonomy.json").read_text()
)

_KINDS = _TAXONOMY["kinds"]
_CASES = _TAXONOMY["cases"]


def build(case: dict[str, Any]) -> FileValidationError:
    if case["kind"] == _KINDS["size"]["value"]:
        return FileSizeError(case["actualSize"], case["maxSize"])
    if case["kind"] == _KINDS["mime"]["value"]:
        return FileMimeError(case["actualMimeType"], case["allowedMimeTypes"])
    if case["kind"] == _KINDS["contentMismatch"]["value"]:
        return FileContentMismatchError(case["claimedMimeType"], case["detectedMimeType"])
    raise AssertionError(f"fixture has an unknown kind: {case['kind']}")


def test_exposes_exactly_the_declared_kinds() -> None:
    exposed = {
        FileValidationKind.SIZE,
        FileValidationKind.MIME,
        FileValidationKind.CONTENT_MISMATCH,
    }
    assert exposed == {kind["value"] for kind in _KINDS.values()}


def test_cases_cover_every_declared_kind() -> None:
    # Positive control: a fixture that silently lost a kind would leave the
    # parametrised tests asserting nothing about it, while still passing.
    covered = {case["kind"] for case in _CASES}
    assert covered == {kind["value"] for kind in _KINDS.values()}


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_carries_the_portable_kind(case: dict[str, Any]) -> None:
    assert build(case).kind == case["kind"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_is_catchable_as_file_validation_error(case: dict[str, Any]) -> None:
    with pytest.raises(FileValidationError):
        raise build(case)


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_carries_the_structured_fields(case: dict[str, Any]) -> None:
    error = build(case)
    if isinstance(error, FileSizeError):
        assert error.actual_size == case["actualSize"]
        assert error.max_size == case["maxSize"]
    elif isinstance(error, FileMimeError):
        assert error.actual_mime_type == case["actualMimeType"]
        assert list(error.allowed_mimes) == case["allowedMimeTypes"]
    elif isinstance(error, FileContentMismatchError):
        assert error.claimed_mime_type == case["claimedMimeType"]
        assert error.detected_mime_type == case["detectedMimeType"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_has_a_non_empty_message(case: dict[str, Any]) -> None:
    # The wording is deliberately NOT pinned across ports — Go's is idiomatically
    # Go. That every port says something is still worth checking.
    assert build(case).message
