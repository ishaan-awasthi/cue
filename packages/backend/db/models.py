from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class AudioSignal(BaseModel):
    transcript_chunk: str
    filler_word_count: int
    words_per_minute: float
    pitch_variance: float
    volume_rms: float
    timestamp: datetime


class AudienceSignal(BaseModel):
    attention_score: float          # 0–1
    faces_detected: int
    looking_away_pct: float         # 0–1
    timestamp: datetime


class Nudge(BaseModel):
    text: str
    trigger_signal: str             # e.g. "filler_word_rate", "attention_score"
    trigger_value: float
    timestamp: datetime


class QAEvent(BaseModel):
    question_text: str
    answer_text: str
    speaker_response_text: str
    similarity_score: float
    whispered: bool
    timestamp: datetime
    # RAG metadata
    confidence: float = 0.0  # top-chunk cosine similarity; 0.0 on fallback
    sources_used: list[str] = Field(default_factory=list)  # filenames that contributed context
    fallback_used: bool = False  # True when answered without RAG
    source: str = "llm_fallback"  # session_docs | llm_fallback
    supporting_context: list[dict[str, str]] = Field(default_factory=list)


class Session(BaseModel):
    id: str
    user_id: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    overall_score: Optional[float] = None
    summary: Optional[dict[str, Any]] = None


class SessionEvent(BaseModel):
    id: str
    session_id: str
    timestamp: datetime
    event_type: str                 # audio_signal | audience_signal | nudge | qa_event
    payload: dict[str, Any]


class UserMetrics(BaseModel):
    id: str
    user_id: str
    session_id: str
    metric_name: str
    value: float
    recorded_at: datetime


class DocumentChunk(BaseModel):
    id: str
    user_id: str
    file_id: str
    chunk_text: str
    chunk_index: int
    embedding: Optional[list[float]] = None
    similarity: Optional[float] = None  # from match_chunks RPC
    filename: Optional[str] = None  # from match_chunks RPC
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_db_row(cls, row: dict) -> "DocumentChunk":
        """Parse Supabase row; pgvector returns embedding as string '[0.1,...]'."""
        data = dict(row)
        emb = data.get("embedding")
        if isinstance(emb, str):
            import ast
            data["embedding"] = ast.literal_eval(emb) if emb else None
        return cls(**data)


class UploadedFile(BaseModel):
    id: str
    user_id: str
    session_id: Optional[str] = None
    filename: str
    file_type: str
    mime_type: Optional[str] = None
    uploaded_at: datetime
    chunk_count: int
    processing_status: Literal["uploaded", "parsing", "embedded", "ready", "failed"] = "uploaded"
    processed_at: Optional[datetime] = None
    failed_reason: Optional[str] = None
