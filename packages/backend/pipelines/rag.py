"""RAG pipeline.

Two responsibilities:
1. File ingestion: extract text from uploaded files, chunk it (~500 tokens),
   embed with OpenAI text-embedding-3-small, store in Supabase pgvector.
2. Q&A retrieval: embed an incoming question, similarity-search pgvector,
   pass question + top-3 chunks to Claude Haiku, return a concise answer.
"""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path

import tiktoken
from openai import AsyncOpenAI

from ..config import settings
from ..db import queries
from ..db.models import DocumentChunk

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Clients (lazily shared)
# ---------------------------------------------------------------------------

_openai: AsyncOpenAI | None = None

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536

QA_MODEL = "gpt-4o-mini"

CHUNK_TOKENS = 500
CHUNK_OVERLAP = 50  # token overlap between adjacent chunks

_TOKENIZER = tiktoken.get_encoding("cl100k_base")


def _get_openai() -> AsyncOpenAI:
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

async def embed_text(text: str) -> list[float]:
    """Return a 1536-dim embedding for *text* using OpenAI."""
    # print(f"[rag] Embedding text ({len(text)} chars) via {EMBEDDING_MODEL}...")
    resp = await _get_openai().embeddings.create(model=EMBEDDING_MODEL, input=text)
    # print(f"[rag] Embedding complete ({EMBEDDING_DIM} dims)")
    return resp.data[0].embedding


# ---------------------------------------------------------------------------
# File ingestion
# ---------------------------------------------------------------------------

async def ingest_file(
    file_id: str,
    user_id: str,
    filename: str,
    file_type: str,
    content: bytes,
) -> int:
    """Extract, chunk, embed, and store the file. Returns chunk count."""
    # print(f"[rag] Ingesting file: {filename} ({len(content)} bytes, type={file_type})")
    text = _extract_text(filename, file_type, content)
    if not text.strip():
        # print(f"[rag] No text extracted from {filename}")
        return 0

    chunks = _chunk_text(text)
    # print(f"[rag] Split into {len(chunks)} chunks (~{CHUNK_TOKENS} tokens each)")
    for idx, chunk in enumerate(chunks):
        # print(f"[rag] Embedding chunk {idx + 1}/{len(chunks)}...")
        embedding = await embed_text(chunk)
        queries.insert_chunk(
            file_id=file_id,
            user_id=user_id,
            chunk_text=chunk,
            chunk_index=idx,
            embedding_vector=embedding,
        )

    # chunk_count is maintained by increment_chunk_count() called inside insert_chunk()

    logger.info("Ingested %d chunks for file %s", len(chunks), filename)
    # print(f"[rag] Ingestion complete: {len(chunks)} chunks stored for {filename}")
    return len(chunks)


def _extract_text(filename: str, file_type: str, content: bytes) -> str:
    """Dispatch to the right extractor based on file type."""
    ft = file_type.lower().lstrip(".")
    name_lower = filename.lower()

    if ft in ("pdf",) or name_lower.endswith(".pdf"):
        return _extract_pdf(content)
    if ft in ("pptx",) or name_lower.endswith(".pptx"):
        return _extract_pptx(content)
    if ft in ("docx",) or name_lower.endswith(".docx"):
        return _extract_docx(content)
    if ft in ("md", "markdown") or name_lower.endswith(".md"):
        return content.decode("utf-8", errors="replace")
    # Plain text fallback
    return content.decode("utf-8", errors="replace")


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(content))
    parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def _extract_pptx(content: bytes) -> str:
    from pptx import Presentation
    prs = Presentation(io.BytesIO(content))
    parts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = " ".join(run.text for run in para.runs).strip()
                    if text:
                        parts.append(text)
    return "\n\n".join(parts)


def _extract_docx(content: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(content))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _chunk_text(text: str) -> list[str]:
    """Split *text* into ~CHUNK_TOKENS-token chunks with CHUNK_OVERLAP overlap."""
    tokens = _TOKENIZER.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + CHUNK_TOKENS, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append(_TOKENIZER.decode(chunk_tokens))
        if end == len(tokens):
            break
        start += CHUNK_TOKENS - CHUNK_OVERLAP
    return chunks


# ---------------------------------------------------------------------------
# Q&A retrieval
# ---------------------------------------------------------------------------

async def answer_question(user_id: str, question: str) -> str:
    """Embed question, retrieve top-3 chunks, generate a whisper-ready answer."""
    try:
        # print(f"[rag] answer_question: \"{question}\" for user {user_id}")
        query_embedding = await embed_text(question)
        chunks: list[DocumentChunk] = await _retrieve_chunks(user_id, query_embedding)

        if not chunks:
            # print(f"[rag] No matching chunks found — no answer generated")
            return ""

        # print(f"[rag] Retrieved {len(chunks)} chunk(s) from pgvector")

        context = "\n\n---\n\n".join(c.chunk_text for c in chunks)
        prompt = (
            f"You are a real-time presentation coach whispering a brief answer into the "
            f"speaker's earpiece. Based only on the reference material below, answer the "
            f"audience question in 1-3 concise sentences. Do not say 'based on the material' "
            f"or use filler phrases — speak naturally as if you know the answer.\n\n"
            f"Reference material:\n{context}\n\n"
            f"Audience question: {question}\n\n"
            f"Answer:"
        )

        # print(f"[rag] Calling {QA_MODEL} for answer generation...")
        resp = await _get_openai().chat.completions.create(
            model=QA_MODEL,
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = (resp.choices[0].message.content or "").strip()
        # print(f"[rag] Generated answer: \"{answer}\"")
        return answer
    except Exception as exc:
        logger.error("RAG answer_question failed: %s", exc)
        # print(f"[rag] ERROR in answer_question: {exc}")
        return ""


async def _retrieve_chunks(user_id: str, embedding: list[float]) -> list[DocumentChunk]:
    import asyncio
    return await asyncio.to_thread(queries.similarity_search, user_id, embedding, 3)
