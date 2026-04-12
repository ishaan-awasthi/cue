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

def insert_file(
    user_id: str,
    filename: str,
    file_type: str,
    mime_type: str | None = None,
    session_id: str | None = None,
) -> UploadedFile:
    row = (
        supabase.table("uploaded_files")
        .insert(
            {
                "user_id": user_id,
                "session_id": session_id,
                "filename": filename,
                "file_type": file_type,
                "mime_type": mime_type,
                "uploaded_at": _now(),
                "chunk_count": 0,
                "processing_status": "uploaded",
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
    metadata: dict[str, Any] | None = None,
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
                "metadata": metadata or {},
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
    session_id: str | None = None,
) -> list[DocumentChunk]:
    """Cosine similarity search via pgvector RPC (003); returns chunks with filename."""
    payload: dict[str, Any] = {
        "query_embedding": query_embedding,
        "match_user_id": user_id,
        "match_count": top_k,
    }
    if session_id:
        payload["match_session_id"] = session_id

    rows = (
        supabase.rpc(
            "match_chunks",
            payload,
        )
        .execute()
        .data
    )
    return [DocumentChunk.from_db_row(r) for r in rows]


def delete_file(file_id: str, user_id: str | None = None) -> None:
    # Chunks cascade-delete via FK constraint (ON DELETE CASCADE in migration)
    query = supabase.table("uploaded_files").delete().eq("id", file_id)
    if user_id:
        query = query.eq("user_id", user_id)
    query.execute()


def list_files(user_id: str, session_id: str | None = None) -> list[UploadedFile]:
    query = (
        supabase.table("uploaded_files")
        .select("*")
        .eq("user_id", user_id)
    )
    if session_id:
        query = query.eq("session_id", session_id)
    rows = query.order("uploaded_at", desc=True).execute().data
    return [UploadedFile(**r) for r in rows]


def get_file(file_id: str) -> UploadedFile:
    row = supabase.table("uploaded_files").select("*").eq("id", file_id).execute().data[0]
    return UploadedFile(**row)


def update_file_status(
    file_id: str,
    status: str,
    chunk_count: int | None = None,
    failed_reason: str | None = None,
) -> UploadedFile:
    payload: dict[str, Any] = {"processing_status": status}
    if chunk_count is not None:
        payload["chunk_count"] = chunk_count
    if status in ("ready", "failed"):
        payload["processed_at"] = _now()
    if failed_reason is not None:
        payload["failed_reason"] = failed_reason[:500]
    row = (
        supabase.table("uploaded_files")
        .update(payload)
        .eq("id", file_id)
        .execute()
        .data[0]
    )
    return UploadedFile(**row)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
