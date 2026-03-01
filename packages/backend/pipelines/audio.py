"""Audio pipeline.

Receives raw PCM audio chunks from the WebSocket handler, simultaneously:
  1. Streams to Deepgram real-time API for word-level transcripts, filler detection, and WPM.
  2. Buffers audio and runs librosa every 5 s to extract pitch variance and volume (RMS).

Emits AudioSignal objects to the coaching pipeline and the QA pipeline every 5 seconds.
Also exposes a rolling transcript string to qa.py for question detection.
"""

from __future__ import annotations

import asyncio
import math
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Awaitable

import numpy as np
import librosa
from deepgram import DeepgramClient, LiveTranscriptionEvents
from deepgram.clients.live.v1 import LiveOptions

from ..config import settings
from ..db.models import AudioSignal

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

AudioSignalCallback = Callable[[AudioSignal], Awaitable[None]]
TranscriptCallback = Callable[[str], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16_000        # Hz — Deepgram expects 16 kHz
EMIT_INTERVAL = 1.0         # seconds between AudioSignal emissions
LIBROSA_WINDOW = 5.0        # seconds of audio buffered for librosa analysis

# Filler words tracked by Deepgram's model
FILLER_WORDS = {"uh", "um", "like", "you know", "so", "basically", "literally"}


class AudioPipeline:
    """Manages a live Deepgram connection and emits AudioSignals periodically."""

    def __init__(
        self,
        session_id: str,
        on_signal: AudioSignalCallback,
        on_transcript_chunk: TranscriptCallback,
    ) -> None:
        self._session_id = session_id
        self._on_signal = on_signal
        self._on_transcript_chunk = on_transcript_chunk

        # Audio buffer for librosa (raw int16 samples as float32)
        self._audio_buffer: deque[np.ndarray] = deque()
        self._buffer_seconds: float = 0.0

        # Deepgram state
        self._dg_client = DeepgramClient(settings.DEEPGRAM_API_KEY)
        self._connection = None

        # Rolling metrics from Deepgram
        self._words_per_minute: float = 0.0
        self._filler_count_window: int = 0
        self._transcript_window: list[str] = []
        self._rolling_transcript: str = ""

        # Emit loop task
        self._emit_task: asyncio.Task | None = None
        self._running = False
        self._audio_chunks_received: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Open Deepgram connection and start the emit loop."""
        # print(f"[audio] Starting AudioPipeline for session {self._session_id}")
        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=False,
            encoding="linear16",
            sample_rate=SAMPLE_RATE,
            channels=1,
        )

        self._connection = self._dg_client.listen.live.v("1")

        self._connection.on(LiveTranscriptionEvents.Transcript, self._on_deepgram_transcript)
        self._connection.on(LiveTranscriptionEvents.Error, self._on_deepgram_error)

        if not self._connection.start(options):
            raise RuntimeError("Failed to start Deepgram live connection")

        # print(f"[audio] Deepgram connection established (nova-2, {SAMPLE_RATE} Hz)")
        self._running = True
        self._emit_task = asyncio.create_task(self._emit_loop())

    async def push_audio(self, pcm_bytes: bytes) -> None:
        """Feed raw PCM bytes from the WebSocket into Deepgram and the librosa buffer."""
        if not self._running or self._connection is None:
            return

        self._audio_chunks_received += 1
        # if self._audio_chunks_received == 1:
        #     print(f"[audio] First audio chunk received ({len(pcm_bytes)} bytes) — Deepgram streaming started")
        # elif self._audio_chunks_received % 100 == 0:
        #     print(f"[audio] {self._audio_chunks_received} audio chunks received so far ({self._buffer_seconds:.1f}s buffered)")

        # Forward to Deepgram
        self._connection.send(pcm_bytes)

        # Accumulate for librosa
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self._audio_buffer.append(samples)
        self._buffer_seconds += len(samples) / SAMPLE_RATE

    async def stop(self) -> None:
        """Tear down the pipeline."""
        self._running = False
        if self._emit_task:
            self._emit_task.cancel()
            try:
                await self._emit_task
            except asyncio.CancelledError:
                pass
        if self._connection:
            self._connection.finish()

    @property
    def rolling_transcript(self) -> str:
        return self._rolling_transcript

    # ------------------------------------------------------------------
    # Deepgram callbacks (called from Deepgram's internal thread)
    # ------------------------------------------------------------------

    def _on_deepgram_transcript(self, *args, **kwargs) -> None:
        result = kwargs.get("result") or (args[1] if len(args) > 1 else None)
        if result is None:
            return
        try:
            channel = result.channel
            alt = channel.alternatives[0]
            transcript = alt.transcript.strip()
            if not transcript:
                return

            print(f"[audio] Deepgram transcript: \"{transcript}\"")

            # Count filler words in this chunk
            words_lower = [w.word.lower() for w in alt.words]
            filler_count = sum(1 for w in words_lower if w in FILLER_WORDS)
            self._filler_count_window += filler_count
            if filler_count > 0:
                fillers_found = [w for w in words_lower if w in FILLER_WORDS]
                # print(f"[audio] Filler words detected: {fillers_found} (+{filler_count} this chunk, {self._filler_count_window} total in window)")

            # WPM from Deepgram metadata when available
            metadata = getattr(result, "metadata", None)
            if metadata and hasattr(metadata, "request_id"):
                pass  # WPM computed locally below

            # Accumulate words for WPM estimate
            self._transcript_window.extend(words_lower)

            # Update rolling transcript for Q&A
            self._rolling_transcript = (self._rolling_transcript + " " + transcript).strip()[-4000:]

            # Forward transcript chunk to QA pipeline (schedule on event loop)
            asyncio.get_event_loop().call_soon_threadsafe(
                asyncio.ensure_future,
                self._on_transcript_chunk(transcript),
            )
        except Exception:
            pass  # never crash the Deepgram thread

    def _on_deepgram_error(self, *args, **kwargs) -> None:
        error = kwargs.get("error") or (args[1] if len(args) > 1 else args)
        # print(f"[audio] Deepgram error: {error}")

    # ------------------------------------------------------------------
    # Emit loop
    # ------------------------------------------------------------------

    async def _emit_loop(self) -> None:
        while self._running:
            await asyncio.sleep(EMIT_INTERVAL)
            if not self._running:
                break
            signal = await self._build_signal()
            db = (20 * math.log10(signal.volume_rms) + 50) if signal.volume_rms > 0 else 0.0
            print(
                f"[audio] WPM={signal.words_per_minute:6.1f}  "
                f"vol={db:+6.1f}dB  "
                f"fillers={signal.filler_word_count}"
                + (f"  transcript=\"{signal.transcript_chunk}\"" if signal.transcript_chunk else "")
            )
            await self._on_signal(signal)

            # Reset per-window counters
            self._filler_count_window = 0
            self._transcript_window = []

    async def _build_signal(self) -> AudioSignal:
        # Compute WPM from words accumulated in the window
        word_count = len(self._transcript_window)
        wpm = (word_count / EMIT_INTERVAL) * 60.0

        # Librosa analysis on buffered audio
        pitch_variance, volume_rms = self._librosa_analysis()

        transcript_chunk = " ".join(self._transcript_window)

        return AudioSignal(
            transcript_chunk=transcript_chunk,
            filler_word_count=self._filler_count_window,
            words_per_minute=round(wpm, 1),
            pitch_variance=round(float(pitch_variance), 4),
            volume_rms=round(float(volume_rms), 4),
            timestamp=datetime.now(timezone.utc),
        )

    def _librosa_analysis(self) -> tuple[float, float]:
        if not self._audio_buffer:
            # print("[audio] Librosa: no audio buffer yet — skipping analysis")
            return 0.0, 0.0

        # Concatenate all buffered chunks and trim to LIBROSA_WINDOW seconds
        audio = np.concatenate(list(self._audio_buffer))
        max_samples = int(LIBROSA_WINDOW * SAMPLE_RATE)
        if len(audio) > max_samples:
            audio = audio[-max_samples:]

        # Trim old buffer entries, keep only the most recent window
        total_kept = 0
        trimmed: deque[np.ndarray] = deque()
        for chunk in reversed(self._audio_buffer):
            if total_kept + len(chunk) <= max_samples:
                trimmed.appendleft(chunk)
                total_kept += len(chunk)
            else:
                break
        self._audio_buffer = trimmed
        self._buffer_seconds = total_kept / SAMPLE_RATE

        # Volume: RMS energy
        volume_rms = float(np.sqrt(np.mean(audio ** 2)))

        # Pitch: fundamental frequency via pyin, compute variance of voiced frames
        try:
            f0, voiced_flag, _ = librosa.pyin(
                audio,
                fmin=librosa.note_to_hz("C2"),
                fmax=librosa.note_to_hz("C7"),
                sr=SAMPLE_RATE,
            )
            voiced_f0 = f0[voiced_flag] if voiced_flag is not None else np.array([])
            pitch_variance = float(np.var(voiced_f0)) if len(voiced_f0) > 1 else 0.0
        except Exception:
            pitch_variance = 0.0

        # print(f"[audio] Librosa: pitch_variance={pitch_variance:.4f}, volume_rms={volume_rms:.4f} (from {len(audio)/SAMPLE_RATE:.1f}s audio)")
        return pitch_variance, volume_rms
