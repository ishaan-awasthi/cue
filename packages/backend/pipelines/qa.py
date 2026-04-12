"""Q&A bail-out pipeline with guardrail logic.

Design: "Generate every answer as a fallback, but only speak when needed."

Listens to the rolling transcript from audio.py.
State machine:
  IDLE → QUESTION_DETECTED (CAPTURING) → BUFFERING_AND_GENERATING
    → MONITORING_PRESENTER_RESPONSE → CANCEL_NUDGE or DELIVER_NUDGE → RESET (IDLE)

When a question is detected:
  1. Buffer question chunks for QUESTION_CAPTURE_WINDOW_SECONDS.
  2. Fire RAG lookup (returns answer, confidence, sources).
  3. Compare speaker response to RAG answer via cosine similarity.
  4. Heuristics: filler-heavy stalling, vague non-answer, low RAG confidence → whisper.
  5. Heuristics: high similarity, substantial response → cancel nudge.
"""

from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime, timezone
from typing import Callable, Awaitable

import numpy as np

from ..config import settings
from ..db import queries
from ..db.models import QAEvent
from ..pipelines import rag
from ..tts import synthesize_streaming, UTTERANCE_SENTINEL

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SendBytesCallback = Callable[[bytes], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_SPEAKER_WORDS = 10

_FILLER_STALL_PATTERNS = re.compile(
    r"\b(that'?s a good question|let me think|uh+|um+|umm+|er+|well,?\s*let me see|"
    r"i mean|you know|like,?\s*uh|so,?\s*uh)\b",
    re.IGNORECASE,
)

_VAGUE_SHORT_PHRASES = frozenset({
    "i'm not sure", "i don't know", "good question", "that's a good question",
    "let me think", "i'm not certain", "i'd have to check", "that's unclear",
})

_QUESTION_WORDS = {
    "who", "what", "where", "when", "why", "how", "is", "are",
    "was", "were", "will", "would", "can", "could", "should",
    "do", "does", "did",
}


class QAPipeline:
    """Detects questions and optionally whispers RAG-based answers."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        send_audio: SendBytesCallback,
        get_rolling_transcript: Callable[[], str],
    ) -> None:
        self._session_id = session_id
        self._user_id = user_id
        self._send_audio = send_audio
        self._get_rolling_transcript = get_rolling_transcript

        self._active: dict | None = None
        self._lock = asyncio.Lock()
        self._running = False

    async def start(self) -> None:
        self._running = True

    async def on_transcript_chunk(self, chunk: str) -> None:
        """Called by audio pipeline for every Deepgram transcript chunk."""
        if not self._running:
            return

        chunk = chunk.strip()
        if not chunk:
            return

        if self._is_question(chunk):
            async with self._lock:
                if self._active is None:
                    asyncio.create_task(self._handle_question(chunk))

    async def stop(self) -> None:
        self._running = False

    @staticmethod
    def _is_question(text: str) -> bool:
        stripped = text.strip()
        if stripped.endswith("?"):
            return True
        first_word = stripped.split()[0].lower().rstrip(",") if stripped else ""
        return first_word in _QUESTION_WORDS and len(stripped.split()) >= 4

    async def _handle_question(self, initial_chunk: str) -> None:
        """State: CAPTURING — buffer question for QUESTION_CAPTURE_WINDOW_SECONDS, then RAG."""
        capture_sec = getattr(settings, "QUESTION_CAPTURE_WINDOW_SECONDS", 3.0)
        baseline_at_detect = self._get_rolling_transcript()
        await asyncio.sleep(capture_sec)

        async with self._lock:
            if self._active is not None:
                return
            self._active = {
                "question": initial_chunk,
                "start_time": time.monotonic(),
                "speaker_baseline": self._get_rolling_transcript(),
            }

        current = self._get_rolling_transcript()
        question_text = initial_chunk
        if current.startswith(baseline_at_detect):
            delta = current[len(baseline_at_detect):].strip()
            if delta:
                question_text = delta
        if "?" in question_text:
            idx = question_text.rfind("?")
            question_text = question_text[: idx + 1].strip()
        if not question_text:
            question_text = initial_chunk

        rag_task = asyncio.create_task(rag.answer_question(self._user_id, question_text, self._session_id))

        try:
            result = await asyncio.wait_for(rag_task, timeout=30.0)
        except asyncio.TimeoutError:
            result = rag.RAGResult(
                answer="",
                confidence=0.0,
                sources_used=[],
                fallback_used=True,
                source="llm_fallback",
                supporting_context=[],
            )

        if not result.answer:
            async with self._lock:
                self._active = None
            return

        async with self._lock:
            if self._active is None:
                return
            state = self._active

        speaker_response = self._get_speaker_delta(state["speaker_baseline"])
        elapsed = time.monotonic() - state["start_time"]
        word_count = len(speaker_response.split())

        should_whisper, similarity_score = await self._decide_whisper(
            speaker_response=speaker_response,
            rag_answer=result.answer,
            rag_confidence=result.confidence,
            word_count=word_count,
            elapsed=elapsed,
            fallback_used=result.fallback_used,
        )

        qa_event = QAEvent(
            question_text=question_text,
            answer_text=result.answer,
            speaker_response_text=speaker_response,
            similarity_score=round(similarity_score, 4),
            whispered=should_whisper,
            timestamp=datetime.now(timezone.utc),
            confidence=result.confidence,
            sources_used=result.sources_used,
            fallback_used=result.fallback_used,
            source=result.source,
            supporting_context=result.supporting_context,
        )

        if should_whisper:
            try:
                await self._send_audio(UTTERANCE_SENTINEL)
                async for audio_chunk in synthesize_streaming(result.answer):
                    await self._send_audio(audio_chunk)
            except Exception:
                pass

        try:
            await asyncio.to_thread(
                queries.insert_event,
                self._session_id,
                "qa_event",
                qa_event.model_dump(mode="json"),
            )
        except Exception:
            pass

        async with self._lock:
            self._active = None

    def _get_speaker_delta(self, baseline: str) -> str:
        current = self._get_rolling_transcript()
        if current.startswith(baseline):
            return current[len(baseline):].strip()
        return current[-300:].strip()

    async def _decide_whisper(
        self,
        speaker_response: str,
        rag_answer: str,
        rag_confidence: float,
        word_count: int,
        elapsed: float,
        fallback_used: bool,
    ) -> tuple[bool, float]:
        """Returns (should_whisper, similarity_score)."""
        knows, similarity = await self._presenter_seems_to_know_answer(
            speaker_response, rag_answer, word_count, elapsed, rag_confidence, fallback_used
        )
        return (not knows, similarity)

    async def _presenter_seems_to_know_answer(
        self,
        speaker_response: str,
        rag_answer: str,
        word_count: int,
        elapsed: float,
        rag_confidence: float,
        fallback_used: bool,
    ) -> tuple[bool, float]:
        """Returns (True, similarity) to cancel nudge, (False, similarity) to whisper."""
        similarity = 0.0

        if word_count < MIN_SPEAKER_WORDS and elapsed >= settings.QA_SILENCE_TIMEOUT_SECONDS:
            return (False, 0.0)

        if fallback_used or rag_confidence < 0.4:
            if word_count < MIN_SPEAKER_WORDS:
                return (False, 0.0)

        sr_lower = speaker_response.lower().strip()
        if sr_lower in _VAGUE_SHORT_PHRASES or any(p in sr_lower for p in _VAGUE_SHORT_PHRASES):
            return (False, 0.0)

        filler_matches = len(_FILLER_STALL_PATTERNS.findall(speaker_response))
        words = len(speaker_response.split())
        if words > 0 and filler_matches >= 2 and (filler_matches / max(words, 1)) > 0.3:
            return (False, 0.0)

        if speaker_response.strip() and rag_answer.strip():
            try:
                similarity = await self._cosine_similarity(speaker_response, rag_answer)
            except Exception:
                pass

        if similarity >= settings.QA_MATCH_THRESHOLD:
            return (True, similarity)

        if word_count >= MIN_SPEAKER_WORDS * 2 and similarity > 0.3:
            return (True, similarity)

        return (False, similarity)

    @staticmethod
    async def _cosine_similarity(text_a: str, text_b: str) -> float:
        if not text_a.strip() or not text_b.strip():
            return 0.0
        emb_a, emb_b = await asyncio.gather(
            rag.embed_text(text_a),
            rag.embed_text(text_b),
        )
        a = np.array(emb_a)
        b = np.array(emb_b)
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        if denom < 1e-10:
            return 0.0
        return float(np.dot(a, b) / denom)
