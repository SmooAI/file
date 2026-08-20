"""The Python loader for the shared lazy-streaming contract.

Every port has one of these and they all read the SAME file
(``spec/lazy-stream-contract.json``). Copying the numbers into this module
instead is the drift this fixture exists to stop.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from smooai_file import File

_CONTRACT: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "lazy-stream-contract.json").read_text()
)

_CASES = _CONTRACT["cases"]


def source_bytes(byte_length: int) -> bytes:
    pattern: str = _CONTRACT["fill"]["pattern"]
    repeats = -(-byte_length // len(pattern))
    return (pattern * repeats).encode()[:byte_length]


async def chunked_stream(payload: bytes, chunk_size: int = 4096) -> AsyncIterator[bytes]:
    """Delivers the payload in small chunks, like a socket would."""
    for offset in range(0, len(payload), chunk_size):
        yield payload[offset : offset + chunk_size]


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def test_head_bytes_matches_contract() -> None:
    assert File._HEAD_BYTES == _CONTRACT["headBytes"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
def test_fixture_content_hashes_are_reproducible(case: dict[str, Any]) -> None:
    # Positive control: without this, a broken source_bytes() would make every
    # assertion below compare two identically-wrong values and pass.
    payload = source_bytes(case["sourceBytes"])
    assert len(payload) == case["sourceBytes"]
    assert sha256(payload) == case["sha256"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
async def test_lazy_constructor_laziness(case: dict[str, Any]) -> None:
    file = await File.from_stream(chunked_stream(source_bytes(case["sourceBytes"])), lazy=True)

    assert file.is_lazy is case["lazyAfterConstruct"]
    assert (file.size is not None) is case["sizeKnownAfterConstruct"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
async def test_full_read_yields_every_byte(case: dict[str, Any]) -> None:
    file = await File.from_stream(chunked_stream(source_bytes(case["sourceBytes"])), lazy=True)
    data = await file.read()

    assert len(data) == case["sourceBytes"]
    assert sha256(data) == case["sha256"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
async def test_iteration_yields_every_byte(case: dict[str, Any]) -> None:
    file = await File.from_stream(chunked_stream(source_bytes(case["sourceBytes"])), lazy=True)

    digest = hashlib.sha256()
    total = 0
    async for chunk in file.iter_bytes():
        digest.update(chunk)
        total += len(chunk)

    assert total == case["sourceBytes"]
    assert digest.hexdigest() == case["sha256"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["name"])
async def test_eager_constructor_buffers_everything(case: dict[str, Any]) -> None:
    eager = _CONTRACT["eagerConstructor"]
    file = await File.from_stream(chunked_stream(source_bytes(case["sourceBytes"])), lazy=False)

    assert file.is_lazy is eager["lazyAfterConstruct"]
    assert (file.size is not None) is eager["sizeKnownAfterConstruct"]
    assert file.size == case["sourceBytes"]


@pytest.mark.asyncio
async def test_read_caches_and_iteration_does_not() -> None:
    assert _CONTRACT["fullRead"]["readCaches"] is True
    assert _CONTRACT["fullRead"]["iterCaches"] is False
    assert _CONTRACT["fullRead"]["payloadReplayedAfterIteration"] is False
    case = _CASES[-1]
    payload = source_bytes(case["sourceBytes"])

    cached = await File.from_stream(chunked_stream(payload), lazy=True)
    assert sha256(await cached.read()) == case["sha256"]
    assert sha256(await cached.read()) == case["sha256"]

    consumed = await File.from_stream(chunked_stream(payload), lazy=True)
    async for _chunk in consumed.iter_bytes():
        pass
    # Python reports the drained tail as an empty read; Go raises instead. The
    # fixture names that divergence — what all five share is non-replay.
    leftovers = await consumed.read()
    assert len(leftovers) != case["sourceBytes"]
    assert leftovers == b""
