# Real-Time Session Q&A (Developer Note)

## Architecture
- Upload endpoints create `uploaded_files` rows with `session_id`, `processing_status`, and metadata.
- Background ingestion parses file content, chunks text, generates embeddings, and stores `document_chunks`.
- Retrieval uses pgvector RPC `match_chunks` and is strictly scoped to `user_id` + `session_id` + `processing_status='ready'`.
- Q&A generation path:
  - grounded path: uses retrieved chunks and returns `source: "session_docs"`
  - fallback path: existing LLM flow when retrieval is weak or docs are unavailable, returns `source: "llm_fallback"`

## Integration Point
- Live whisper flow remains in `QAPipeline` (`packages/backend/pipelines/qa.py`).
- Retrieval plug-in point is `rag.answer_question(user_id, question, session_id)`.
- Session prep UI keeps existing flow in `packages/web/app/app/sessions/[id]/page.tsx`, now wired to `/sessions/{id}/files`.

## Extension Points
- Swap embedding model/provider in `packages/backend/pipelines/rag.py::embed_text`.
- Swap generator provider chain in `packages/backend/pipelines/rag.py::_chat_complete`.
- Swap retrieval backend by replacing `queries.similarity_search` + `match_chunks` RPC.
- Add richer parser metadata by extending `_extract_*_sections` and `document_chunks.metadata`.
