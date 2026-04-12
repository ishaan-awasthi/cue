"""All Supabase read/write logic. Nothing else in the codebase touches Supabase directly."""

from datetime import datetime, timezone
from typing import Any, Optional

from .client import supabase
from .models import (
    DocumentChunk,
    Session,
    SessionEvent,
    UploadedFile,
    UserMetrics,
)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def create_session(user_id: str) -> Session:
    row = (
        supabase.table("sessions")
        .insert({"user_id": user_id, "started_at": _now()})
        .execute()
        .data[0]
    )
    return Session(**row)


def end_session(session_id: str, metrics: dict[str, Any]) -> Session:
    """Mark session as ended and write aggregate metrics into the summary column."""
    now = _now()
    # Fetch started_at to compute duration
    existing = supabase.table("sessions").select("started_at").eq("id", session_id).execute().data[0]
    started = datetime.fromisoformat(existing["started_at"])
    ended = datetime.fromisoformat(now)
    duration = int((ended - started).total_seconds())

    row = (
        supabase.table("sessions")
        .update(
            {
                "ended_at": now,
                "duration_seconds": duration,
                "overall_score": metrics.get("overall_score"),
                "summary": metrics,
            }
        )
        .eq("id", session_id)
        .execute()
        .data[0]
    )
    return Session(**row)


def get_session(session_id: str) -> Session:
    row = supabase.table("sessions").select("*").eq("id", session_id).execute().data[0]
    return Session(**row)


def list_sessions(user_id: str) -> list[Session]:
    rows = (
        supabase.table("sessions")
        .select("*")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .execute()
        .data
    )
    return [Session(**r) for r in rows]


# ---------------------------------------------------------------------------
# Session events
# ---------------------------------------------------------------------------

def insert_event(session_id: str, event_type: str, payload: dict[str, Any]) -> SessionEvent:
    row = (
        supabase.table("session_events")
        .insert(
            {
                "session_id": session_id,
                "timestamp": _now(),
                "event_type": event_type,
                "payload": payload,
            }
        )
        .execute()
        .data[0]
    )
    return SessionEvent(**row)


def get_session_events(session_id: str) -> list[SessionEvent]:
    rows = (
        supabase.table("session_events")
        .select("*")
        .eq("session_id", session_id)
        .order("timestamp")
        .execute()
        .data
    )
    return [SessionEvent(**r) for r in rows]


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def upsert_metrics(session_id: str, user_id: str, metrics_dict: dict[str, float]) -> None:
    now = _now()
    rows = [
        {
            "user_id": user_id,
            "session_id": session_id,
            "metric_name": name,
            "value": value,
            "recorded_at": now,
        }
        for name, value in metrics_dict.items()
    ]
    if rows:
        supabase.table("metrics").insert(rows).execute()


# ---------------------------------------------------------------------------
# Files & RAG chunks
# ---------------------------------------------------------------------------

def insert_file(user_id: str, filename: str, file_type: str) -> UploadedFile:
    row = (
        supabase.table("uploaded_files")
        .insert(
            {
                "user_id": user_id,
                "filename": filename,
                "file_type": file_type,
                "uploaded_at": _now(),
                "chunk_count": 0,
            }
        )
        .execute()
        .data[0]
    )
    return UploadedFile(**row)


def insert_chunk(
    file_id: str,
    user_id: str,
    chunk_text: str,
    chunk_index: int,
    embedding_vector: list[float],
) -> DocumentChunk:
    row = (
        supabase.table("document_chunks")
        .insert(
            {
                "file_id": file_id,
                "user_id": user_id,
                "chunk_text": chunk_text,
                "chunk_index": chunk_index,
                "embedding": embedding_vector,
            }
        )
        .execute()
        .data[0]
    )
    # Update chunk_count on the parent file
    supabase.rpc(
        "increment_chunk_count",
        {"file_id_arg": file_id},
    ).execute()
    return DocumentChunk(**row)


def similarity_search(
    user_id: str,
    query_embedding: list[float],
    top_k: int = 3,
) -> list[DocumentChunk]:
    """Cosine similarity search via pgvector RPC (defined in migration 002)."""
    rows = (
        supabase.rpc(
            "match_chunks",
            {
                "query_embedding": query_embedding,
                "match_user_id": user_id,
                "match_count": top_k,
            },
        )
        .execute()
        .data
    )
    return [DocumentChunk(**r) for r in rows]


def delete_file(file_id: str) -> None:
    # Chunks cascade-delete via FK constraint (ON DELETE CASCADE in migration)
    supabase.table("uploaded_files").delete().eq("id", file_id).execute()


def list_files(user_id: str) -> list[UploadedFile]:
    rows = (
        supabase.table("uploaded_files")
        .select("*")
        .eq("user_id", user_id)
        .order("uploaded_at", desc=True)
        .execute()
        .data
    )
    return [UploadedFile(**r) for r in rows]


# ---------------------------------------------------------------------------
# Transcripts (Supabase Storage — bucket: "transcripts")
# ---------------------------------------------------------------------------

TRANSCRIPT_BUCKET = "transcripts"


def save_transcript(session_id: str, timestamp_utc: str, text: str) -> str:
    """Upload transcript text to Supabase Storage.

    Stored at: transcripts/{session_id}_{timestamp_utc}.txt
    Returns the storage path.
    """
    path = f"{session_id}_{timestamp_utc}.txt"
    supabase.storage.from_(TRANSCRIPT_BUCKET).upload(
        path=path,
        file=text.encode("utf-8"),
        file_options={"content-type": "text/plain; charset=utf-8", "upsert": "true"},
    )
    return path


def get_transcript(session_id: str) -> Optional[str]:
    """Download the transcript text for a session.

    Lists the bucket to find the file whose name starts with session_id,
    then downloads it. Returns None if not found.
    """
    files = supabase.storage.from_(TRANSCRIPT_BUCKET).list()
    match = next((f for f in files if f["name"].startswith(session_id)), None)
    if not match:
        return None
    data = supabase.storage.from_(TRANSCRIPT_BUCKET).download(match["name"])
    return data.decode("utf-8")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
