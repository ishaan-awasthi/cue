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
from fastapi.responses import Response

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
# TTS test
# ---------------------------------------------------------------------------

@app.post("/tts/test")
async def test_tts(body: dict):
    """Synthesize arbitrary text via Deepgram Aura and return raw PCM audio.
    Useful for verifying TTS independently of a live session."""
    from .tts import synthesize

    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="'text' field is required")

    audio = await synthesize(text)
    return Response(
        content=audio,
        media_type="audio/L16;rate=24000;channels=1",
    )


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
# Utility
# ---------------------------------------------------------------------------

async def asyncio_to_thread(fn, *args):
    return await asyncio.to_thread(fn, *args)
