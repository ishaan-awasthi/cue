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
import re
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Awaitable

from ..config import settings
from ..db import queries
from ..db.models import AudioSignal, AudienceSignal, Nudge
from ..tts import synthesize_streaming, UTTERANCE_SENTINEL
from .audio import EMIT_INTERVAL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SendBytesCallback = Callable[[bytes], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Keyword-triggered nudges — fire immediately on transcript match
_KEYWORD_RULES: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r'\bliterally\b', re.IGNORECASE),              "keyword_literally", "Cut filler words"),
    (re.compile(r'\bslow(?:ly|er|est|ing|ed)?\b', re.IGNORECASE), "keyword_slow",      "Pick up the pace"),
    (re.compile(r'\bquick(?:ly|er|est)?\b', re.IGNORECASE),    "keyword_quick",     "Slow down"),
    (re.compile(r'\bloud(?:ly|er|est)?\b', re.IGNORECASE),     "keyword_loud",      "Watch your volume"),
]

SIGNAL_WINDOW_SECONDS = 5
MIN_WPM = 20.0
MAX_WPM = 160.0

# Volume RMS below this for an extended window is considered "too quiet"
VOLUME_THRESHOLD = 0.005
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

        # Cooldown: track last fire time per nudge type to avoid spam
        self._last_nudge_time: dict[str, float] = {}
        self._nudge_cooldown_seconds: float = 15.0

        # Delivery lock: don't start a new nudge while one is playing
        self._nudge_in_progress: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        # print(f"[coaching] Starting CoachingPipeline for session {self._session_id} (nudge interval: {settings.NUDGE_INTERVAL_SECONDS}s)")
        self._running = True
        self._nudge_task = asyncio.create_task(self._nudge_loop())

    async def on_audio_signal(self, signal: AudioSignal) -> None:
        self._audio_signals.append(signal)
        self._trim_window()
        # print(
        #     f"[coaching] Audio signal received — WPM={signal.words_per_minute}, "
        #     f"fillers={signal.filler_word_count}, pitch_var={signal.pitch_variance:.4f}, "
        #     f"volume={signal.volume_rms:.4f} | window size: {len(self._audio_signals)}"
        # )
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
        # print(
        #     f"[coaching] Audience signal received — attention={signal.attention_score:.3f}, "
        #     f"faces={signal.faces_detected}, looking_away_pct={signal.looking_away_pct:.3f} "
        #     f"| window size: {len(self._audience_signals)}"
        # )
        await asyncio.to_thread(
            queries.insert_event,
            self._session_id,
            "audience_signal",
            signal.model_dump(mode="json"),
        )

    async def on_transcript_chunk(self, chunk: str) -> None:
        for pattern, trigger_signal, text in _KEYWORD_RULES:
            if pattern.search(chunk):
                nudge = self._make_nudge(text, trigger_signal, 0.0)
                if nudge:
                    asyncio.create_task(self._fire_nudge(nudge))
                break  # one nudge per chunk

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
            # print(f"[coaching] Evaluating nudge rules ({len(self._audio_signals)} audio, {len(self._audience_signals)} audience signals in window)...")
            if self._nudge_in_progress:
                continue
            nudge = self._evaluate()
            if nudge:
                # print(f"[coaching] Nudge triggered! trigger={nudge.trigger_signal} value={nudge.trigger_value} — \"{nudge.text}\"")
                await self._fire_nudge(nudge)
            else:
                pass  # print("[coaching] No nudge needed — all thresholds within range")

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
            avg_volume = sum(s.volume_rms for s in audio_list) / len(audio_list)
            avg_pitch_var = sum(s.pitch_variance for s in audio_list) / len(audio_list)

            if any(s.filler_word_count > 1 for s in audio_list):
                max_fillers = max(s.filler_word_count for s in audio_list)
                return self._make_nudge(
                    "cut filler words",
                    "filler_word_rate",
                    float(max_fillers),
                )

            if avg_wpm < MIN_WPM:
                return self._make_nudge(
                    "Pick up pace",
                    "words_per_minute",
                    round(avg_wpm, 1),
                )

            if avg_wpm > MAX_WPM:
                return self._make_nudge(
                    "Slow down",
                    "words_per_minute",
                    round(avg_wpm, 1),
                )

            if avg_volume < VOLUME_THRESHOLD:
                return self._make_nudge(
                    "Project your voice",
                    "volume_rms",
                    round(avg_volume, 4),
                )

            if avg_pitch_var < PITCH_VARIANCE_THRESHOLD and avg_wpm > 50:
                return self._make_nudge(
                    "Vary tone.",
                    "pitch_variance",
                    round(avg_pitch_var, 2),
                )

        # ----- Audience-based rules -----
        if audience_list:
            avg_attention = sum(s.attention_score for s in audience_list) / len(audience_list)
            # print(f"[coaching] Avg attention={avg_attention:.3f} (threshold: {settings.ATTENTION_THRESHOLD})")
            if avg_attention < settings.ATTENTION_THRESHOLD:
                return self._make_nudge(
                    "Re-engage room",
                    "attention_score",
                    round(avg_attention, 3),
                )

        return None

    def _make_nudge(self, text: str, trigger_signal: str, trigger_value: float) -> Nudge | None:
        import time
        now = time.monotonic()
        last = self._last_nudge_time.get(trigger_signal, 0.0)
        if now - last < self._nudge_cooldown_seconds:
            return None
        return Nudge(
            text=text,
            trigger_signal=trigger_signal,
            trigger_value=trigger_value,
            timestamp=datetime.now(timezone.utc),
        )

    async def _fire_nudge(self, nudge: Nudge) -> None:
        import time
        self._nudge_in_progress = True
        try:
            await self._send_audio(UTTERANCE_SENTINEL)
            async for chunk in synthesize_streaming(nudge.text):
                await self._send_audio(chunk)
            self._last_nudge_time[nudge.trigger_signal] = time.monotonic()

            # Persist
            await asyncio.to_thread(
                queries.insert_event,
                self._session_id,
                "nudge",
                nudge.model_dump(mode="json"),
            )
            logger.info("Nudge fired: %s (%.3f)", nudge.trigger_signal, nudge.trigger_value)
            # print(f"[coaching] Nudge persisted to DB")
        except Exception as exc:
            logger.error("Failed to fire nudge: %s", exc)
            # print(f"[coaching] ERROR firing nudge: {exc}")
        finally:
            self._nudge_in_progress = False
