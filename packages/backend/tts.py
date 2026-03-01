"""Deepgram Aura TTS wrapper.

Provides both buffered and streaming synthesis:
  - synthesize()           → returns complete PCM bytes (linear16, 24 kHz, mono)
  - synthesize_streaming() → async generator yielding PCM chunks as they arrive

Both include retry logic (up to TTS_MAX_RETRIES) and per-request timeout
(TTS_TIMEOUT_SECONDS) from config.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from .config import settings

logger = logging.getLogger(__name__)

_SPEAK_URL = "https://api.deepgram.com/v1/speak"

UTTERANCE_SENTINEL = b"CUE!"


def _request_params() -> dict:
    return {
        "model": settings.DEEPGRAM_TTS_MODEL,
        "encoding": "linear16",
        "sample_rate": "24000",
        "container": "none",
    }


def _request_headers() -> dict:
    return {
        "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
        "Content-Type": "application/json",
    }


@asynccontextmanager
async def _stream_with_retry(text: str) -> AsyncIterator[httpx.Response]:
    """Open a streaming POST to Deepgram Aura with retry + timeout."""
    last_exc: Exception | None = None
    for attempt in range(1 + settings.TTS_MAX_RETRIES):
        if attempt > 0:
            delay = min(2 ** attempt, 8)
            logger.warning("TTS retry %d/%d in %.1fs", attempt, settings.TTS_MAX_RETRIES, delay)
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=settings.TTS_TIMEOUT_SECONDS) as client:
                async with client.stream(
                    "POST",
                    _SPEAK_URL,
                    params=_request_params(),
                    headers=_request_headers(),
                    json={"text": text},
                ) as resp:
                    resp.raise_for_status()
                    yield resp
                    return
        except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc = exc
            logger.error("TTS attempt %d failed: %s", attempt + 1, exc)
    raise last_exc  # type: ignore[misc]


async def synthesize_streaming(text: str) -> AsyncIterator[bytes]:
    """Yield raw linear16 PCM chunks (24 kHz, mono) as they stream from Deepgram."""
    async with _stream_with_retry(text) as resp:
        async for chunk in resp.aiter_bytes():
            if chunk:
                yield chunk


async def synthesize(text: str) -> bytes:
    """Convenience wrapper: buffer all chunks and return complete PCM bytes."""
    chunks: list[bytes] = []
    async for chunk in synthesize_streaming(text):
        chunks.append(chunk)
    return b"".join(chunks)
