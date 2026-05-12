"""Lazy streaming tests — verify large streams don't blow process memory.

The pitch in the README is "2 GB upload doesn't blow your Lambda memory". This
suite holds us to that with a 100 MB synthetic stream and a process-memory
ceiling of 50 MB delta during ``iter_bytes`` consumption.
"""

from __future__ import annotations

import os
import resource
from collections.abc import AsyncIterator

import pytest

from smooai_file import File


def _rss_mb() -> float:
    """Resident set size in MB. Cross-platform handling for ru_maxrss units."""
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS returns bytes, Linux returns kilobytes.
    if os.uname().sysname == "Darwin":
        return rss / (1024 * 1024)
    return rss / 1024


class TestLazyStreaming:
    """Lazy streams keep peak memory bounded while detection still runs."""

    async def test_lazy_stream_preserves_head_for_detection(self) -> None:
        # Build a fake 10 MB PNG stream — only the first chunk should be
        # consumed at construction time.
        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * (64 * 1024 - 8)

        chunks_yielded = [0]

        async def gen() -> AsyncIterator[bytes]:
            yield png_header
            for _ in range(10):
                chunks_yielded[0] += 1
                yield b"\x00" * (1024 * 1024)  # 1 MB chunks

        f = await File.from_stream(gen(), lazy=True)
        # Detection ran on the head — mime should be image/png.
        assert f.mime_type == "image/png"
        # Tail has NOT been drained yet — chunks_yielded should be 0.
        assert chunks_yielded[0] == 0
        # Size is unknown until the tail drains.
        assert f.size is None

    async def test_iter_bytes_streams_without_full_buffer(self) -> None:
        """100 MB stream consumed chunk-by-chunk; peak RSS delta stays < 50 MB."""
        # Generate 100 x 1 MB chunks lazily — never holding the full 100 MB.
        total_size = 100 * 1024 * 1024
        chunk_size = 1024 * 1024

        async def big_gen() -> AsyncIterator[bytes]:
            sent = 0
            chunk = b"A" * chunk_size
            while sent < total_size:
                yield chunk
                sent += chunk_size

        baseline = _rss_mb()
        f = await File.from_stream(big_gen(), lazy=True)
        peak = baseline

        consumed = 0
        async for chunk in f.iter_bytes():
            consumed += len(chunk)
            current = _rss_mb()
            if current > peak:
                peak = current
            # Critical: we never accumulate the full payload.

        assert consumed == total_size
        delta = peak - baseline
        # Generous ceiling — we expect single-digit MB delta, allow up to 50.
        # If the implementation buffered the full 100 MB this would jump well
        # past 100 MB.
        assert delta < 50, f"RSS delta {delta:.1f} MB exceeded 50 MB ceiling"
        # After full iteration size is now known.
        assert f.size == total_size

    async def test_lazy_eager_fallback_buffers_everything(self) -> None:
        """lazy=False keeps the legacy fully-buffered behavior."""

        async def gen() -> AsyncIterator[bytes]:
            yield b"hello"
            yield b" "
            yield b"world"

        f = await File.from_stream(gen(), lazy=False)
        assert f.size == 11
        assert await f.read() == b"hello world"

    async def test_lazy_stream_short_payload_promotes_to_eager(self) -> None:
        """If the source exhausts within the head buffer, size is known up front."""

        async def gen() -> AsyncIterator[bytes]:
            yield b"hello world"

        f = await File.from_stream(gen(), lazy=True)
        # Source was fully consumed during head-read → size is known.
        assert f.size == 11
        assert await f.read() == b"hello world"

    async def test_iter_bytes_is_consume_once_on_lazy(self) -> None:
        """iter_bytes drains the tail and does NOT cache (memory pitch). A
        second iter sees an exhausted stream."""

        async def gen() -> AsyncIterator[bytes]:
            yield b"A" * (64 * 1024)  # head exactly
            yield b"B" * (32 * 1024)
            yield b"C" * (32 * 1024)

        f = await File.from_stream(gen(), lazy=True)
        first_pass = b"".join([chunk async for chunk in f.iter_bytes()])
        assert len(first_pass) == 64 * 1024 + 32 * 1024 + 32 * 1024
        # Size is now known post-iteration.
        assert f.size == 64 * 1024 + 32 * 1024 + 32 * 1024
        # Second pass yields nothing — stream is exhausted, no caching by design.
        second_pass = b"".join([chunk async for chunk in f.iter_bytes()])
        assert second_pass == b""


@pytest.mark.skipif(
    os.environ.get("CI") == "true",
    reason="moto-backed upload test is slow on CI; covered by unit upload paths",
)
class TestLazyUploadToS3:
    """Streaming upload through SpooledTemporaryFile drains the lazy tail."""

    async def test_upload_to_s3_drains_lazy_stream(self) -> None:
        import boto3
        from moto import mock_aws

        with mock_aws():
            s3 = boto3.client("s3", region_name="us-east-1")
            s3.create_bucket(Bucket="test-bucket")

            async def gen() -> AsyncIterator[bytes]:
                # 5 MB total, in 1 MB chunks. Exceeds the head buffer so the
                # lazy path is exercised end-to-end.
                for _ in range(5):
                    yield b"\x00" * (1024 * 1024)

            f = await File.from_stream(gen(), lazy=True)
            await f.upload_to_s3("test-bucket", "uploads/big.bin")

            resp = s3.get_object(Bucket="test-bucket", Key="uploads/big.bin")
            assert resp["ContentLength"] == 5 * 1024 * 1024
