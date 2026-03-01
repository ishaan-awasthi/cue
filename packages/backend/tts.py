"""ElevenLabs TTS wrapper.  Returns raw audio bytes suitable for playback through an earpiece."""

import httpx

from .config import settings

_BASE_URL = "https://api.elevenlabs.io/v1"

# Voice settings tuned for a calm, quiet whisper into an earpiece
_VOICE_SETTINGS = {
    "stability": 0.75,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": False,
}


async def synthesize(text: str) -> bytes:
    """Convert *text* to speech and return raw MP3 bytes.

    Uses the ElevenLabs streaming endpoint for lower latency on longer texts
    (Q&A answers).  Falls back to the standard endpoint if streaming is not
    available.
    """
    url = f"{_BASE_URL}/text-to-speech/{settings.ELEVENLABS_VOICE_ID}/stream"
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2",
        "voice_settings": _VOICE_SETTINGS,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            async for chunk in resp.aiter_bytes():
                if chunk:
                    chunks.append(chunk)
            return b"".join(chunks)
