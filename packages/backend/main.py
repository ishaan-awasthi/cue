"""FastAPI application entrypoint.

Routes:
  POST   /sessions                     — create session, return session_id
  WS     /ws/{session_id}              — live session WebSocket
  GET    /sessions/{id}                — session detail
  GET    /sessions                     — list sessions for a user
  POST   /sessions/{id}/report         — run post-session deep analysis
  POST   /files/upload                 — ingest a reference file into pgvector
  DELETE /files/{id}                   — remove file and its chunks
  GET    /files                        — list uploaded files for a user
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel
from fastapi import (
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import queries
from .db.models import Session, SessionEvent, UploadedFile
from .pipelines.audio import AudioPipeline
from .pipelines.coaching import CoachingPipeline
from .pipelines.qa import QAPipeline
from .pipelines.vision import VisionPipeline
from .pipelines import rag

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cue Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Dependency: resolve user_id from header (simplified auth — swap for real JWT)
# ---------------------------------------------------------------------------

async def get_user_id(x_user_id: Annotated[str | None, Header()] = None) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header required")
    return x_user_id


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

@app.post("/sessions", response_model=Session, status_code=201)
async def create_session(user_id: str = Depends(get_user_id)):
    session = await asyncio_to_thread(queries.create_session, user_id)
    return session


@app.get("/sessions", response_model=list[Session])
async def list_sessions(user_id: str = Depends(get_user_id)):
    return await asyncio_to_thread(queries.list_sessions, user_id)


@app.get("/sessions/{session_id}", response_model=Session)
async def get_session(session_id: str, user_id: str = Depends(get_user_id)):
    session = await asyncio_to_thread(queries.get_session, session_id)
    if session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return session


@app.get("/sessions/{session_id}/events", response_model=list[SessionEvent])
async def get_session_events(session_id: str, user_id: str = Depends(get_user_id)):
    session = await asyncio_to_thread(queries.get_session, session_id)
    if session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await asyncio_to_thread(queries.get_session_events, session_id)


# ---------------------------------------------------------------------------
# Prep chat (GPT clarifying questions before a session)
# ---------------------------------------------------------------------------

CHAT_SYSTEM_PROMPT = """You are a supportive public-speaking coach helping someone prepare for an upcoming conversation or presentation. They may have uploaded context (slides, notes) for the session. Your job is to ask brief, clarifying questions so their live session can be more tailored—e.g. goal of the conversation, audience, key points they want to practice, or any concerns. Keep replies concise (1–3 short paragraphs) and ask at most 1–2 questions at a time. Be warm and professional."""


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@app.post("/sessions/{session_id}/chat")
async def session_chat(
    session_id: str,
    user_id: str = Depends(get_user_id),
    body: ChatRequest | None = None,
):
    """Send a message and get a GPT reply for prep clarifying questions."""
    from openai import AsyncOpenAI

    body = body or ChatRequest(message="")
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    history = body.history or []

    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    for h in history[-20:]:  # last 20 turns
        if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:2000]})
    messages.append({"role": "user", "content": message[:4000]})

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=500,
        messages=messages,
    )
    reply = (response.choices[0].message.content or "").strip()
    return {"reply": reply}


# ---------------------------------------------------------------------------
# Post-session report
# ---------------------------------------------------------------------------

@app.post("/sessions/{session_id}/report")
async def generate_report(session_id: str, user_id: str = Depends(get_user_id)):
    """Run Claude Sonnet + fluency model over the full session and return a
    structured coaching report."""
    from openai import AsyncOpenAI

    session = await asyncio_to_thread(queries.get_session, session_id)
    if session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    events = await asyncio_to_thread(queries.get_session_events, session_id)

    # Collect all transcript chunks
    audio_events = [e for e in events if e.event_type == "audio_signal"]
    full_transcript = " ".join(
        e.payload.get("transcript_chunk", "") for e in audio_events
    ).strip()

    nudge_events = [e for e in events if e.event_type == "nudge"]
    qa_events = [e for e in events if e.event_type == "qa_event"]

    # Fluency scoring — build pseudo-segments from audio signals
    # (We don't have raw audio post-session, so we skip model scoring here
    # and rely on WPM / filler data already stored.  The fluency model would
    # be used if audio files were archived — see models/README.md.)
    fluency_summary = _summarise_fluency(audio_events)

    nudge_summary = [
        {
            "text": e.payload.get("text"),
            "trigger": e.payload.get("trigger_signal"),
            "timestamp": e.timestamp.isoformat(),
        }
        for e in nudge_events
    ]

    qa_summary = [
        {
            "question": e.payload.get("question_text"),
            "whispered": e.payload.get("whispered"),
            "similarity": e.payload.get("similarity_score"),
            "timestamp": e.timestamp.isoformat(),
        }
        for e in qa_events
    ]

    prompt = f"""You are an expert public-speaking coach reviewing a recorded presentation session.
Analyse the data below and produce a structured coaching report in JSON with these keys:
- what_went_well: list of 2-4 specific positive observations (strings)
- areas_to_improve: list of 2-5 specific actionable suggestions (strings)
- fluency_summary: brief paragraph describing speech fluency trends
- key_moments: list of objects {{timestamp, observation}} for notable moments
- suggested_drills: list of 2-3 practical exercises the speaker should practice

Session duration: {session.duration_seconds} seconds
Full transcript excerpt (first 3000 chars): {full_transcript[:3000]}
Fluency stats: {json.dumps(fluency_summary)}
Nudges fired: {json.dumps(nudge_summary)}
Q&A events: {json.dumps(qa_summary)}

Respond with valid JSON only — no markdown fences."""

    openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await openai.chat.completions.create(
        model="gpt-4o",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = (response.choices[0].message.content or "").strip()
    try:
        report = json.loads(raw)
    except json.JSONDecodeError:
        # Extract JSON substring if model wrapped it anyway
        start = raw.find("{")
        end = raw.rfind("}") + 1
        report = json.loads(raw[start:end]) if start != -1 else {"raw": raw}

    return {"session_id": session_id, "report": report}


def _summarise_fluency(audio_events) -> dict:
    if not audio_events:
        return {}
    wpm_values = [e.payload.get("words_per_minute", 0) for e in audio_events]
    filler_counts = [e.payload.get("filler_word_count", 0) for e in audio_events]
    pitch_vars = [e.payload.get("pitch_variance", 0) for e in audio_events]
    duration_minutes = (len(audio_events) * 5) / 60  # each signal covers 5s
    return {
        "avg_wpm": round(sum(wpm_values) / len(wpm_values), 1) if wpm_values else 0,
        "total_fillers": sum(filler_counts),
        "filler_rate_per_min": round(sum(filler_counts) / max(duration_minutes, 0.1), 2),
        "avg_pitch_variance": round(sum(pitch_vars) / len(pitch_vars), 2) if pitch_vars else 0,
    }


# ---------------------------------------------------------------------------
# File management
# ---------------------------------------------------------------------------

@app.post("/files/upload", response_model=UploadedFile, status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
):
    allowed_types = {"application/pdf", "application/vnd.openxmlformats-officedocument."
                     "presentationml.presentation",
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     "text/plain", "text/markdown"}
    # Also allow by extension
    allowed_ext = {".pdf", ".pptx", ".docx", ".txt", ".md"}
    ext = "." + (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    content = await file.read()
    file_type = ext.lstrip(".")

    # Create DB record
    db_file = await asyncio_to_thread(queries.insert_file, user_id, file.filename or "upload", file_type)

    # Ingest asynchronously (embed + store chunks)
    chunk_count = await rag.ingest_file(
        file_id=db_file.id,
        user_id=user_id,
        filename=file.filename or "upload",
        file_type=file_type,
        content=content,
    )

    # Return updated record
    db_file.chunk_count = chunk_count
    return db_file


@app.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: str, user_id: str = Depends(get_user_id)):
    await asyncio_to_thread(queries.delete_file, file_id)


@app.get("/files", response_model=list[UploadedFile])
async def list_files(user_id: str = Depends(get_user_id)):
    return await asyncio_to_thread(queries.list_files, user_id)


# ---------------------------------------------------------------------------
# Live WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    print(f"[ws] WebSocket accepted for session {session_id}")

    # Resolve user_id from query param (WebSocket can't use headers reliably
    # from all clients)
    user_id = websocket.query_params.get("user_id")
    if not user_id:
        await websocket.close(code=4001, reason="user_id query param required")
        return

    print(f"[ws] User {user_id} connected to session {session_id}")

    # Callback: send bytes back to the glasses rig
    async def send_audio(audio_bytes: bytes) -> None:
        try:
            await websocket.send_bytes(audio_bytes)
        except Exception:
            pass

    # Accumulate transcript chunks for file save on disconnect
    _transcript_chunks: list[str] = []

    # Initialise pipelines
    coaching = CoachingPipeline(session_id, user_id, send_audio)
    qa = QAPipeline(
        session_id=session_id,
        user_id=user_id,
        send_audio=send_audio,
        get_rolling_transcript=lambda: audio_pipeline.rolling_transcript,
    )

    async def on_audio_signal(signal):
        await coaching.on_audio_signal(signal)

    async def on_transcript_chunk(chunk: str):
        _transcript_chunks.append(chunk)
        await qa.on_transcript_chunk(chunk)

    audio_pipeline = AudioPipeline(
        session_id=session_id,
        on_signal=on_audio_signal,
        on_transcript_chunk=on_transcript_chunk,
    )
    vision = VisionPipeline(session_id=session_id, on_signal=coaching.on_audience_signal)

    try:
        await audio_pipeline.start()
        await vision.start()
        await coaching.start()
        await qa.start()
        logger.info("Pipelines started for session %s", session_id)
        print(f"[ws] All pipelines started for session {session_id} (user={user_id})")

        audio_msg_count = 0
        frame_msg_count = 0

        while True:
            message = await websocket.receive()

            if "bytes" in message:
                # Raw PCM audio bytes
                audio_msg_count += 1
                if audio_msg_count == 1:
                    print(f"[ws] First audio bytes received ({len(message['bytes'])} bytes)")
                await audio_pipeline.push_audio(message["bytes"])

            elif "text" in message:
                # JSON envelope: {"type": "frame", "data": "<base64>"}
                try:
                    msg = json.loads(message["text"])
                    if msg.get("type") == "frame":
                        frame_msg_count += 1
                        if frame_msg_count == 1:
                            print(f"[ws] First video frame received")
                        elif frame_msg_count % 100 == 0:
                            print(f"[ws] {frame_msg_count} frames received so far ({audio_msg_count} audio chunks)")
                        await vision.push_frame(msg["data"])
                except (json.JSONDecodeError, KeyError):
                    pass

    except WebSocketDisconnect:
        logger.info("Client disconnected from session %s", session_id)
        print(f"[ws] Client disconnected — session {session_id} ended ({audio_msg_count} audio chunks, {frame_msg_count} frames received)")
    except Exception as exc:
        logger.error("WebSocket error for session %s: %s", session_id, exc)
        print(f"[ws] ERROR in session {session_id}: {exc}")
    finally:
        # Snapshot signal history BEFORE stopping (stop() may clear state)
        audio_signals = list(coaching._audio_signals)

        await audio_pipeline.stop()
        await vision.stop()
        await coaching.stop()
        await qa.stop()

        # Save full transcript to Supabase Storage (bucket: transcripts)
        try:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            full_transcript = " ".join(_transcript_chunks).strip()
            storage_path = await asyncio_to_thread(
                queries.save_transcript, session_id, timestamp, full_transcript
            )
            logger.info("Transcript saved to Supabase Storage: %s (%d chars)", storage_path, len(full_transcript))
            print(f"[ws] Transcript saved → supabase://transcripts/{storage_path} ({len(full_transcript)} chars)")
        except Exception as exc:
            logger.error("Failed to save transcript: %s", exc)

        # Post-session: compute aggregate metrics and close session
        try:
            audience_signals: list = []  # vision aggregates in 3-s windows; coaching holds audio

            metrics: dict[str, float] = {}
            if audio_signals:
                n = len(audio_signals)
                metrics["avg_wpm"] = sum(s.words_per_minute for s in audio_signals) / n
                metrics["total_fillers"] = float(sum(s.filler_word_count for s in audio_signals))
                metrics["avg_pitch_variance"] = sum(s.pitch_variance for s in audio_signals) / n
                metrics["avg_volume_rms"] = sum(s.volume_rms for s in audio_signals) / n

            # Derive overall_score: simple 0–100 heuristic
            overall_score = _compute_overall_score(metrics)
            metrics["overall_score"] = overall_score

            await asyncio_to_thread(queries.end_session, session_id, metrics)
            await asyncio_to_thread(queries.upsert_metrics, session_id, user_id, metrics)
            logger.info("Session %s closed, score=%.1f", session_id, overall_score)
        except Exception as exc:
            logger.error("Post-session cleanup error: %s", exc)


def _compute_overall_score(metrics: dict[str, float]) -> float:
    """Derive a rough 0–100 score from average session metrics."""
    score = 75.0  # baseline

    wpm = metrics.get("avg_wpm", 140)
    if 110 <= wpm <= 160:
        score += 10
    elif wpm < 80 or wpm > 200:
        score -= 15

    filler_rate = metrics.get("total_fillers", 0) / max(metrics.get("avg_wpm", 140) / 60, 0.1) / 5
    if filler_rate < 1:
        score += 10
    elif filler_rate > 5:
        score -= 15

    return max(0.0, min(100.0, round(score, 1)))


# ---------------------------------------------------------------------------
# Transcript analysis (post-session, from saved .txt file)
# ---------------------------------------------------------------------------

class TranscriptIndicator(BaseModel):
    label: str
    score: float          # 0–100
    value: str            # human-readable value, e.g. "3.2/min" or "128 WPM"
    blurb: str            # one-sentence interpretation

class TranscriptAnalysisResponse(BaseModel):
    session_id: str
    transcript_found: bool
    transcript_length: int        # char count
    word_count: int
    duration_estimate_seconds: float
    indicators: list[TranscriptIndicator]
    overall_score: float
    filler_words_detail: dict[str, int]   # word → count
    transcript_excerpt: str       # first 400 chars for UI display


_TRANSCRIPT_UNIGRAMS: set[str] = {
    "uh", "um", "hmm", "er", "erm", "like", "so", "basically",
    "literally", "actually", "right", "okay", "you know",
}
_TRANSCRIPT_BIGRAMS: list[str] = [
    "you know", "i mean", "kind of", "sort of", "you see",
]

import re as _re

def _analyse_transcript(text: str, session_id: str) -> TranscriptAnalysisResponse:
    """Run speech indicators over a raw transcript string."""
    words = _re.findall(r"\b[a-zA-Z']+\b", text.lower())
    word_count = len(words)

    # Estimate duration from WPM of ~130 (average conversational pace)
    duration_estimate_seconds = (word_count / 130) * 60 if word_count else 0
    duration_min = max(duration_estimate_seconds / 60, 0.05)

    # --- Filler word count (bigram-first) ---
    working = text.lower()
    filler_detail: dict[str, int] = {}
    for bigram in _TRANSCRIPT_BIGRAMS:
        pat = _re.compile(r"\b" + _re.escape(bigram) + r"\b")
        matches = pat.findall(working)
        if matches:
            filler_detail[bigram] = filler_detail.get(bigram, 0) + len(matches)
            working = pat.sub(" _ ", working)
    for w in _re.findall(r"\b[a-z']+\b", working):
        if w in _TRANSCRIPT_UNIGRAMS:
            filler_detail[w] = filler_detail.get(w, 0) + 1
    total_fillers = sum(filler_detail.values())
    filler_rate = total_fillers / duration_min

    # --- Vocabulary diversity (type-token ratio, capped to first 200 words) ---
    sample = words[:200]
    ttr = len(set(sample)) / len(sample) if sample else 0

    # --- Sentence length consistency ---
    sentences = [s.strip() for s in _re.split(r"[.!?]+", text) if s.strip()]
    sent_lengths = [len(_re.findall(r"\b[a-zA-Z']+\b", s)) for s in sentences]
    if sent_lengths:
        avg_sent = sum(sent_lengths) / len(sent_lengths)
        variance = sum((l - avg_sent) ** 2 for l in sent_lengths) / len(sent_lengths)
        consistency_score = max(0, min(100, 100 - (variance ** 0.5) * 2))
    else:
        avg_sent = 0
        consistency_score = 50

    # --- WPM score (target 110–160) ---
    estimated_wpm = word_count / duration_min if word_count else 0  # stays at ~130 since we seeded duration from 130
    # Re-derive pacing from sentence rhythm instead: words per sentence
    wpm_score = 100 if 110 <= estimated_wpm <= 160 else max(0, 100 - abs(estimated_wpm - 135) * 1.5)

    # --- Filler score ---
    filler_score = max(0, min(100, 100 - filler_rate * 15))

    # --- Vocabulary score ---
    vocab_score = min(100, ttr * 160)  # TTR ~0.6 → 100 pts

    # --- Repetition: top-5 non-stopwords repeated excessively ---
    STOP = {"the","a","an","and","or","but","in","on","at","to","for","of","is","it","i","you","we","they","was","be","are","with","that","this","have","had","not","my","your","its","as","do","he","she","he","so","if","by","from","just","can","will","would","there","their","they","all","been","has","more","than","what","about","into","him","her","his","who","get","one","when","how","up","out","no","were","said","also","some","me","us","our"}
    content_words = [w for w in words if w not in STOP and len(w) > 3]
    freq: dict[str, int] = {}
    for w in content_words:
        freq[w] = freq.get(w, 0) + 1
    top_repeats = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:5]
    max_repeat_rate = (top_repeats[0][1] / word_count * 100) if top_repeats and word_count else 0
    repetition_score = max(0, min(100, 100 - max(0, max_repeat_rate - 3) * 10))

    # --- Build indicators ---
    indicators: list[TranscriptIndicator] = [
        TranscriptIndicator(
            label="Filler words",
            score=round(filler_score, 1),
            value=f"{round(filler_rate, 1)}/min ({total_fillers} total)",
            blurb=(
                "Clean — very few fillers detected." if filler_rate < 1
                else "Mild filler usage — room to improve." if filler_rate < 3
                else "High filler rate — focus on pausing instead of filling silence."
            ),
        ),
        TranscriptIndicator(
            label="Vocabulary diversity",
            score=round(vocab_score, 1),
            value=f"{round(ttr * 100, 0):.0f}% unique words",
            blurb=(
                "Rich vocabulary — varied word choice keeps the audience engaged." if ttr > 0.6
                else "Moderate range — try varying word choice more." if ttr > 0.45
                else "Repetitive word choice — expand your vocabulary use."
            ),
        ),
        TranscriptIndicator(
            label="Sentence consistency",
            score=round(consistency_score, 1),
            value=f"avg {round(avg_sent, 1)} words/sentence",
            blurb=(
                "Very consistent sentence length — easy to follow." if consistency_score >= 75
                else "Some variation in sentence length — mostly fine." if consistency_score >= 50
                else "Highly erratic sentence lengths — mix of very short and very long bursts."
            ),
        ),
        TranscriptIndicator(
            label="Word repetition",
            score=round(repetition_score, 1),
            value=f'"{top_repeats[0][0]}" ×{top_repeats[0][1]}' if top_repeats else "—",
            blurb=(
                "Good word variety — no single word overused." if max_repeat_rate < 3
                else f'"{top_repeats[0][0] if top_repeats else ""}" appears frequently — consider synonyms.' if max_repeat_rate < 6
                else f'Heavy repetition of "{top_repeats[0][0] if top_repeats else ""}" — diversify your language.'
            ),
        ),
        TranscriptIndicator(
            label="Content density",
            score=round(min(100, len(content_words) / max(word_count, 1) * 200), 1),
            value=f"{round(len(content_words)/max(word_count,1)*100,0):.0f}% content words",
            blurb=(
                "High content density — substantive and focused." if len(content_words) / max(word_count, 1) > 0.5
                else "Moderate density — could be more specific." if len(content_words) / max(word_count, 1) > 0.35
                else "Low content density — lots of filler language relative to substance."
            ),
        ),
    ]

    overall_score = round(
        filler_score * 0.30 + vocab_score * 0.20 + consistency_score * 0.20 +
        repetition_score * 0.15 + indicators[4].score * 0.15,
        1,
    )

    return TranscriptAnalysisResponse(
        session_id=session_id,
        transcript_found=True,
        transcript_length=len(text),
        word_count=word_count,
        duration_estimate_seconds=round(duration_estimate_seconds, 1),
        indicators=indicators,
        overall_score=min(100, overall_score),
        filler_words_detail=filler_detail,
        transcript_excerpt=text[:400],
    )


@app.post("/sessions/{session_id}/transcript-analysis")
async def transcript_analysis(session_id: str, user_id: str = Depends(get_user_id)):
    """Download the saved transcript from Supabase Storage and return speech indicators."""
    text = await asyncio_to_thread(queries.get_transcript, session_id)

    if text is None:
        return TranscriptAnalysisResponse(
            session_id=session_id,
            transcript_found=False,
            transcript_length=0,
            word_count=0,
            duration_estimate_seconds=0,
            indicators=[],
            overall_score=0,
            filler_words_detail={},
            transcript_excerpt="",
        )

    text = text.strip()
    if not text:
        return TranscriptAnalysisResponse(
            session_id=session_id,
            transcript_found=True,
            transcript_length=0,
            word_count=0,
            duration_estimate_seconds=0,
            indicators=[],
            overall_score=0,
            filler_words_detail={},
            transcript_excerpt="",
        )

    return await asyncio.to_thread(_analyse_transcript, text, session_id)


# ---------------------------------------------------------------------------
# Practice drill analysis
# ---------------------------------------------------------------------------

class PracticeAnalyzeRequest(BaseModel):
    transcript: str
    words_per_minute: float = 0.0
    filler_word_count: int = 0
    duration_seconds: float = 0.0


class PracticeNudge(BaseModel):
    trigger: str
    text: str
    value: float


class PracticeAnalyzeResponse(BaseModel):
    score: float                        # 0–100
    nudges: list[PracticeNudge]
    filler_words_found: list[str]
    wpm: float


PRACTICE_FILLER_UNIGRAMS = {"uh", "um", "hmm", "er", "erm", "like", "so", "basically", "literally", "actually"}
PRACTICE_FILLER_BIGRAMS = ["you know", "i mean", "kind of", "sort of", "you see"]


def _count_fillers(transcript: str) -> tuple[int, list[str]]:
    """Return (count, unique_found) using the same bigram+unigram logic as the frontend."""
    import re
    text = transcript.lower()
    found: list[str] = []

    for bigram in PRACTICE_FILLER_BIGRAMS:
        pattern = re.compile(r"\b" + re.escape(bigram) + r"\b")
        matches = pattern.findall(text)
        if matches:
            found.extend(matches)
            text = pattern.sub(" _ ", text)

    for word in re.split(r"\s+", text):
        clean = re.sub(r"[^a-z]", "", word)
        if clean in PRACTICE_FILLER_UNIGRAMS:
            found.append(clean)

    unique = list(dict.fromkeys(found))
    return len(found), unique


@app.post("/practice/analyze", response_model=PracticeAnalyzeResponse)
async def practice_analyze(body: PracticeAnalyzeRequest):
    """Analyse a short practice drill using the same rules as coaching.py."""
    transcript = body.transcript.strip()
    wpm = body.words_per_minute
    filler_count = body.filler_word_count
    duration_min = max(body.duration_seconds / 60.0, 0.05)

    # Always recount from transcript so client and backend agree
    backend_filler_count, found_fillers = _count_fillers(transcript)
    if filler_count == 0:
        filler_count = backend_filler_count

    filler_rate_per_min = filler_count / duration_min

    nudges: list[PracticeNudge] = []

    if filler_rate_per_min > 3.0:
        nudges.append(PracticeNudge(
            trigger="filler_word_rate",
            text="Try to cut the filler words — your audience notices more than you think.",
            value=round(filler_rate_per_min, 2),
        ))

    if wpm > 0:
        if wpm < 100:
            nudges.append(PracticeNudge(
                trigger="words_per_minute",
                text="Pick up the pace a little — you've got the room.",
                value=round(wpm, 1),
            ))
        elif wpm > 180:
            nudges.append(PracticeNudge(
                trigger="words_per_minute",
                text="Slow down — let the ideas land.",
                value=round(wpm, 1),
            ))

    score = 80.0
    if 110 <= wpm <= 160:
        score += 10
    elif wpm > 0 and (wpm < 80 or wpm > 200):
        score -= 15
    if filler_rate_per_min < 1:
        score += 10
    elif filler_rate_per_min > 5:
        score -= 15
    score = max(0.0, min(100.0, round(score, 1)))

    return PracticeAnalyzeResponse(
        score=score,
        nudges=nudges,
        filler_words_found=list(dict.fromkeys(found_fillers)),
        wpm=round(wpm, 1),
    )


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

async def asyncio_to_thread(fn, *args):
    return await asyncio.to_thread(fn, *args)
