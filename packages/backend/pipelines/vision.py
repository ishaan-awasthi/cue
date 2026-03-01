"""Vision pipeline.

Receives pre-processed speaker signals from the glasses rig
({"type": "speaker_signal", "attentive": bool, "head_x": float, ...}).
MediaPipe runs on the glasses rig — no vision inference happens here.

Every 3 seconds emits an AudienceSignal: attention_score (0–1),
faces_detected, looking_away_pct.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Callable, Awaitable

from ..db.models import AudienceSignal

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

AudienceSignalCallback = Callable[[AudienceSignal], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EMIT_INTERVAL = 3.0


class VisionPipeline:
    """Aggregates speaker signals and emits AudienceSignal periodically."""

    def __init__(self, session_id: str, on_signal: AudienceSignalCallback) -> None:
        self._session_id = session_id
        self._on_signal = on_signal
        self._frame_results: list[dict] = []
        self._running = False
        self._emit_task: asyncio.Task | None = None
        self._signals_received: int = 0
        # print(f"[vision] VisionPipeline ready for session {session_id}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        # print(f"[vision] Starting VisionPipeline for session {self._session_id}")
        self._running = True
        self._emit_task = asyncio.create_task(self._emit_loop())

    async def push_signal(self, signal: dict) -> None:
        """Receive a speaker_signal dict from the glasses rig."""
        if not self._running:
            return
        self._frame_results.append(signal)
        self._signals_received += 1
        if self._signals_received == 1:
            print("[vision] First speaker signal received — attention tracking active")
        elif self._signals_received % 100 == 0:
            attentive = signal.get("attentive", True)
            print(
                f"[vision] Signal #{self._signals_received}: "
                f"attentive={attentive}, "
                f"ear={signal.get('ear', 0):.3f}"
            )

    async def stop(self) -> None:
        self._running = False
        if self._emit_task:
            self._emit_task.cancel()
            try:
                await self._emit_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------------
    # Emit loop
    # ------------------------------------------------------------------

    async def _emit_loop(self) -> None:
        while self._running:
            await asyncio.sleep(EMIT_INTERVAL)
            if not self._running:
                break
            frames = self._frame_results
            self._frame_results = []
            signal = self._aggregate(frames)
            # print(
            #     f"[vision] AudienceSignal emitted — "
            #     f"attention={signal.attention_score:.3f}, "
            #     f"looking_away_pct={signal.looking_away_pct:.3f} "
            #     f"(from {len(frames)} signals)"
            # )
            await self._on_signal(signal)

    def _aggregate(self, frames: list[dict]) -> AudienceSignal:
        if not frames:
            return AudienceSignal(
                attention_score=1.0,
                faces_detected=0,
                looking_away_pct=0.0,
                timestamp=datetime.now(timezone.utc),
            )
        looking_away_count = sum(1 for f in frames if not f.get("attentive", True))
        looking_away_pct = looking_away_count / len(frames)
        attention_score = 1.0 - looking_away_pct
        return AudienceSignal(
            attention_score=round(attention_score, 3),
            faces_detected=1,
            looking_away_pct=round(looking_away_pct, 3),
            timestamp=datetime.now(timezone.utc),
        )
