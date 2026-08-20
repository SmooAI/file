"""Basic tests for smooai-file package."""

import json
from pathlib import Path

from smooai_file import File, FileSource, Metadata, MetadataHint, __version__


def test_version_matches_package_json():
    """package.json is the single source of truth for the version across all five
    ports; ``scripts/sync-versions.mjs`` copies it here. Asserting a hardcoded
    literal instead is how this package sat at "1.1.5" while the repo shipped
    2.2.12 — the test pinned the drift in place rather than catching it.
    """
    package_json = json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text())
    assert __version__ == package_json["version"], "run `pnpm version:sync` and commit the result"


def test_file_source_values():
    assert FileSource.URL.value == "Url"
    assert FileSource.BYTES.value == "Bytes"
    assert FileSource.FILE.value == "File"
    assert FileSource.STREAM.value == "Stream"
    assert FileSource.S3.value == "S3"


def test_metadata_defaults():
    m = Metadata()
    assert m.name is None
    assert m.mime_type is None
    assert m.size is None
    assert m.extension is None
    assert m.url is None
    assert m.path is None
    assert m.hash is None
    assert m.last_modified is None
    assert m.created_at is None


def test_exports():
    """Ensure all public names are importable."""
    assert File is not None
    assert FileSource is not None
    assert Metadata is not None
    assert MetadataHint is not None
