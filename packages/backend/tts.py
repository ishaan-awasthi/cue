"""Deepgram Aura TTS wrapper. Returns raw PCM bytes (linear16, 24 kHz, mono)."""

import httpx

from .config import settings

_SPEAK_URL = "https://api.deepgram.com/v1/speak"


async def synthesize(text: str) -> bytes:
    """Convert *text* to speech and return raw linear16 PCM bytes at 24 kHz mono."""
    params = {
        "model": settings.DEEPGRAM_TTS_MODEL,
        "encoding": "linear16",
        "sample_rate": "24000",
        "container": "none",
    }
    headers = {
        "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream(
            "POST",
            _SPEAK_URL,
            params=params,
            headers=headers,
            json={"text": text},
        ) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            async for chunk in resp.aiter_bytes():
                if chunk:
                    chunks.append(chunk)
            return b"".join(chunks)
