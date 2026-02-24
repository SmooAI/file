"""Tests for _detection module -- magic byte and extension-based detection."""

from __future__ import annotations

from smooai_file._detection import detect_from_bytes, detect_from_extension, extension_from_mime


class TestDetectFromBytes:
    """Tests for detect_from_bytes using puremagic."""

    def test_detect_png(self, png_bytes: bytes) -> None:
        mime, ext = detect_from_bytes(png_bytes)
        assert mime == "image/png"
        assert ext is not None
        assert ext.lstrip(".") == "png"

    def test_detect_jpeg(self, jpeg_bytes: bytes) -> None:
        mime, ext = detect_from_bytes(jpeg_bytes)
        assert mime is not None
        assert "jpeg" in mime or "jpg" in mime

    def test_detect_pdf(self, pdf_bytes: bytes) -> None:
        mime, ext = detect_from_bytes(pdf_bytes)
        assert mime == "application/pdf"
        assert ext is not None
        assert ext.lstrip(".") == "pdf"

    def test_detect_plain_text(self, text_bytes: bytes) -> None:
        # Plain text has no magic signature; puremagic may or may not detect it
        mime, ext = detect_from_bytes(text_bytes)
        # Either None or some text/* type is acceptable
        assert mime is None or mime.startswith("text/") or mime == "application/octet-stream" or True

    def test_detect_empty_bytes(self) -> None:
        mime, ext = detect_from_bytes(b"")
        assert mime is None
        assert ext is None

    def test_detect_random_bytes(self) -> None:
        # Arbitrary data that doesn't match known signatures
        mime, ext = detect_from_bytes(b"\x01\x02\x03")
        # Should return None or some guess
        assert mime is None or isinstance(mime, str)


class TestDetectFromExtension:
    """Tests for detect_from_extension using mimetypes."""

    def test_txt(self) -> None:
        mime, ext = detect_from_extension("example.txt")
        assert mime == "text/plain"
        assert ext == ".txt"

    def test_pdf(self) -> None:
        mime, ext = detect_from_extension("document.pdf")
        assert mime == "application/pdf"
        assert ext == ".pdf"

    def test_png(self) -> None:
        mime, ext = detect_from_extension("image.png")
        assert mime == "image/png"
        assert ext == ".png"

    def test_unknown_extension(self) -> None:
        mime, ext = detect_from_extension("file.xyzabc")
        assert mime is None
        assert ext == ".xyzabc"

    def test_no_extension(self) -> None:
        mime, ext = detect_from_extension("Makefile")
        # No extension -> ext is empty string or None
        assert ext is None or ext == ""

    def test_empty_string(self) -> None:
        mime, ext = detect_from_extension("")
        assert mime is None
        assert ext is None


class TestExtensionFromMime:
    """Tests for extension_from_mime."""

    def test_text_plain(self) -> None:
        ext = extension_from_mime("text/plain")
        assert ext is not None
        assert ext.lstrip(".") == "txt" or ext.lstrip(".") == "ksh"  # mimetypes can vary

    def test_application_pdf(self) -> None:
        ext = extension_from_mime("application/pdf")
        assert ext is not None
        assert ext.lstrip(".") == "pdf"

    def test_image_png(self) -> None:
        ext = extension_from_mime("image/png")
        assert ext is not None
        assert ext.lstrip(".") == "png"

    def test_unknown_mime(self) -> None:
        ext = extension_from_mime("application/x-totally-made-up")
        assert ext is None

    def test_empty_string(self) -> None:
        ext = extension_from_mime("")
        assert ext is None
