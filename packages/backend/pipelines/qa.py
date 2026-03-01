"""Q&A bail-out pipeline.

Listens to the rolling transcript from audio.py.
Detects audience questions (Deepgram "?" / rising intonation marker).
When a question is detected:
  1. Fires an async RAG lookup immediately.
  2. Tracks what the speaker says after the question.
  3. When RAG result arrives, compares speaker response to the RAG answer via
     cosine similarity of OpenAI embeddings.
  4. If similarity < QA_MATCH_THRESHOLD, OR speaker has said < 10 words and
     QA_SILENCE_TIMEOUT_SECONDS has elapsed — whispers the answer via TTS.

The natural RAG latency acts as the grace period: by the time the answer
arrives, we already know whether the speaker needs help.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Callable, Awaitable

import numpy as np

from ..config import settings
from ..db import queries
from ..db.models import QAEvent
from ..pipelines import rag
from ..tts import synthesize_streaming, UTTERANCE_SENTINEL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SendBytesCallback = Callable[[bytes], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_SPEAKER_WORDS = 10  # fewer than this → speaker may be struggling

# Simple heuristics for question detection
_QUESTION_ENDINGS = ("?",)
_QUESTION_WORDS = {"who", "what", "where", "when", "why", "how", "is", "are",
                   "was", "were", "will", "would", "can", "could", "should",
                   "do", "does", "did"}


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

        # Active question state
        self._active: dict | None = None   # keys: question, start_time, speaker_baseline_transcript
        self._lock = asyncio.Lock()

        self._running = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._running = True

    async def on_transcript_chunk(self, chunk: str) -> None:
        """Called by audio.py for every incoming Deepgram transcript chunk."""
        if not self._running:
            return

        chunk = chunk.strip()
        if not chunk:
            return

        # Detect a question in this new chunk
        if self._is_question(chunk):
            async with self._lock:
                # Don't interrupt an already-active Q&A
                if self._active is None:
                    asyncio.create_task(self._handle_question(chunk))

    async def stop(self) -> None:
        self._running = False

    # ------------------------------------------------------------------
    # Question detection
    # ------------------------------------------------------------------

    @staticmethod
    def _is_question(text: str) -> bool:
        """Heuristic: text ends with '?' or starts with a question word."""
        stripped = text.strip()
        if stripped.endswith("?"):
            return True
        # Check if first word is a common question opener
        first_word = stripped.split()[0].lower().rstrip(",") if stripped else ""
        return first_word in _QUESTION_WORDS and len(stripped.split()) >= 4

    # ------------------------------------------------------------------
    # Q&A handler
    # ------------------------------------------------------------------

    async def _handle_question(self, question_text: str) -> None:
        async with self._lock:
            self._active = {
                "question": question_text,
                "start_time": time.monotonic(),
                "speaker_baseline": self._get_rolling_transcript(),
            }

        logger.info("Q&A: question detected: %r", question_text)

        # Fire RAG lookup immediately (non-blocking)
        rag_task = asyncio.create_task(rag.answer_question(self._user_id, question_text))

        # Wait for RAG result
        try:
            rag_answer = await asyncio.wait_for(rag_task, timeout=30.0)
        except asyncio.TimeoutError:
            rag_answer = ""

        if not rag_answer:
            async with self._lock:
                self._active = None
            return

        # Check speaker's response since question was asked
        async with self._lock:
            if self._active is None:
                return   # another question took over or pipeline stopped
            state = self._active

        speaker_response = self._get_speaker_delta(state["speaker_baseline"])
        elapsed = time.monotonic() - state["start_time"]
        word_count = len(speaker_response.split())

        # Decide whether to whisper
        should_whisper = False
        similarity = 0.0

        if word_count < MIN_SPEAKER_WORDS and elapsed >= settings.QA_SILENCE_TIMEOUT_SECONDS:
            should_whisper = True
            logger.info("Q&A: speaker silent/brief after timeout — whispering")
        elif rag_answer:
            try:
                similarity = await self._cosine_similarity(speaker_response, rag_answer)
                if similarity < settings.QA_MATCH_THRESHOLD:
                    should_whisper = True
                    logger.info("Q&A: low similarity %.3f — whispering", similarity)
            except Exception as exc:
                logger.error("Q&A similarity check failed: %s", exc)
                should_whisper = word_count < MIN_SPEAKER_WORDS

        qa_event = QAEvent(
            question_text=question_text,
            answer_text=rag_answer,
            speaker_response_text=speaker_response,
            similarity_score=round(similarity, 4),
            whispered=should_whisper,
            timestamp=datetime.now(timezone.utc),
        )

        if should_whisper:
            try:
                await self._send_audio(UTTERANCE_SENTINEL)
                async for chunk in synthesize_streaming(rag_answer):
                    await self._send_audio(chunk)
            except Exception as exc:
                logger.error("Q&A TTS failed: %s", exc)

        # Persist Q&A event
        try:
            await asyncio.to_thread(
                queries.insert_event,
                self._session_id,
                "qa_event",
                qa_event.model_dump(mode="json"),
            )
        except Exception as exc:
            logger.error("Q&A persist failed: %s", exc)

        async with self._lock:
            self._active = None

    def _get_speaker_delta(self, baseline: str) -> str:
        """Return transcript text added since the baseline snapshot."""
        current = self._get_rolling_transcript()
        if current.startswith(baseline):
            return current[len(baseline):].strip()
        # Fallback: return last 300 chars of current transcript
        return current[-300:].strip()

    # ------------------------------------------------------------------
    # Cosine similarity via OpenAI embeddings
    # ------------------------------------------------------------------

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
        denom = (np.linalg.norm(a) * np.linalg.norm(b))
        if denom < 1e-10:
            return 0.0
        return float(np.dot(a, b) / denom)
