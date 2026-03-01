"""Rules-based coaching engine.

Subscribes to AudioSignal and AudienceSignal events.
Maintains a rolling 30-second window of signal history.
Every NUDGE_INTERVAL_SECONDS checks thresholds; if any are crossed,
synthesises a nudge via Deepgram Aura TTS and streams the audio chunks
over the WebSocket to the glasses rig.
All logic is explicit rules — no LLM calls.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Awaitable

from ..config import settings
from ..db import queries
from ..db.models import AudioSignal, AudienceSignal, Nudge
from ..tts import synthesize_streaming, UTTERANCE_SENTINEL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SendBytesCallback = Callable[[bytes], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SIGNAL_WINDOW_SECONDS = 30
MIN_WPM = 100.0
MAX_WPM = 180.0

# Volume RMS below this for an extended window is considered "too quiet"
VOLUME_THRESHOLD = 0.02
# Pitch variance below this for an extended window is considered "monotone"
PITCH_VARIANCE_THRESHOLD = 50.0


class CoachingPipeline:
    """Collects signals, evaluates rules, fires nudges."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        send_audio: SendBytesCallback,
    ) -> None:
        self._session_id = session_id
        self._user_id = user_id
        self._send_audio = send_audio

        # Rolling windows (deques of (timestamp, value) tuples)
        self._audio_signals: deque[AudioSignal] = deque()
        self._audience_signals: deque[AudienceSignal] = deque()

        self._running = False
        self._nudge_task: asyncio.Task | None = None

        # Track the last nudge type to avoid spamming the same nudge back-to-back
        self._last_nudge: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._running = True
        self._nudge_task = asyncio.create_task(self._nudge_loop())

    async def on_audio_signal(self, signal: AudioSignal) -> None:
        self._audio_signals.append(signal)
        self._trim_window()
        # Persist the signal as a session event
        await asyncio.to_thread(
            queries.insert_event,
            self._session_id,
            "audio_signal",
            signal.model_dump(mode="json"),
        )

    async def on_audience_signal(self, signal: AudienceSignal) -> None:
        self._audience_signals.append(signal)
        self._trim_window()
        await asyncio.to_thread(
            queries.insert_event,
            self._session_id,
            "audience_signal",
            signal.model_dump(mode="json"),
        )

    async def stop(self) -> None:
        self._running = False
        if self._nudge_task:
            self._nudge_task.cancel()
            try:
                await self._nudge_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _trim_window(self) -> None:
        """Remove signals older than SIGNAL_WINDOW_SECONDS."""
        now = datetime.now(timezone.utc)

        def _trim(dq):
            while dq and (now - dq[0].timestamp).total_seconds() > SIGNAL_WINDOW_SECONDS:
                dq.popleft()

        _trim(self._audio_signals)
        _trim(self._audience_signals)

    # ------------------------------------------------------------------
    # Nudge loop
    # ------------------------------------------------------------------

    async def _nudge_loop(self) -> None:
        while self._running:
            await asyncio.sleep(settings.NUDGE_INTERVAL_SECONDS)
            if not self._running:
                break
            nudge = self._evaluate()
            if nudge:
                await self._fire_nudge(nudge)

    def _evaluate(self) -> Nudge | None:
        """Evaluate all rules against current window averages. Returns the highest
        priority nudge, or None if all thresholds are within acceptable range."""

        audio_list = list(self._audio_signals)
        audience_list = list(self._audience_signals)

        if not audio_list and not audience_list:
            return None

        # ----- Audio-based rules -----
        if audio_list:
            avg_wpm = sum(s.words_per_minute for s in audio_list) / len(audio_list)
            avg_filler_rate = (
                sum(s.filler_word_count for s in audio_list)
                / (len(audio_list) * (5 / 60))  # signals cover 5s each, convert to per-minute
            )
            avg_volume = sum(s.volume_rms for s in audio_list) / len(audio_list)
            avg_pitch_var = sum(s.pitch_variance for s in audio_list) / len(audio_list)

            if avg_filler_rate > settings.FILLER_WORD_RATE_THRESHOLD:
                return self._make_nudge(
                    "Try to cut the filler words — your audience notices more than you think.",
                    "filler_word_rate",
                    round(avg_filler_rate, 2),
                )

            if avg_wpm < MIN_WPM:
                return self._make_nudge(
                    "Pick up the pace a little — you've got the room.",
                    "words_per_minute",
                    round(avg_wpm, 1),
                )

            if avg_wpm > MAX_WPM:
                return self._make_nudge(
                    "Slow down — let the ideas land.",
                    "words_per_minute",
                    round(avg_wpm, 1),
                )

            if avg_volume < VOLUME_THRESHOLD:
                return self._make_nudge(
                    "Project your voice — speak up a bit.",
                    "volume_rms",
                    round(avg_volume, 4),
                )

            if avg_pitch_var < PITCH_VARIANCE_THRESHOLD and avg_wpm > 50:
                return self._make_nudge(
                    "Vary your tone — a little inflection goes a long way.",
                    "pitch_variance",
                    round(avg_pitch_var, 2),
                )

        # ----- Audience-based rules -----
        if audience_list:
            avg_attention = sum(s.attention_score for s in audience_list) / len(audience_list)
            if avg_attention < settings.ATTENTION_THRESHOLD:
                return self._make_nudge(
                    "Re-engage the room — you're losing them.",
                    "attention_score",
                    round(avg_attention, 3),
                )

        return None

    def _make_nudge(self, text: str, trigger_signal: str, trigger_value: float) -> Nudge | None:
        # Avoid firing the exact same nudge twice in a row
        if self._last_nudge == trigger_signal:
            return None
        return Nudge(
            text=text,
            trigger_signal=trigger_signal,
            trigger_value=trigger_value,
            timestamp=datetime.now(timezone.utc),
        )

    async def _fire_nudge(self, nudge: Nudge) -> None:
        try:
            await self._send_audio(UTTERANCE_SENTINEL)
            async for chunk in synthesize_streaming(nudge.text):
                await self._send_audio(chunk)
            self._last_nudge = nudge.trigger_signal

            # Persist
            await asyncio.to_thread(
                queries.insert_event,
                self._session_id,
                "nudge",
                nudge.model_dump(mode="json"),
            )
            logger.info("Nudge fired: %s (%.3f)", nudge.trigger_signal, nudge.trigger_value)
        except Exception as exc:
            logger.error("Failed to fire nudge: %s", exc)
