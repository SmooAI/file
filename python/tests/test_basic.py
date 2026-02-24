"""Basic tests for smooai-file package."""

from smooai_file import File, FileSource, Metadata, MetadataHint, __version__


def test_version():
    assert __version__ == "1.1.5"


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
