# FastAPI application entrypoint. Defines the following routes:
#
# POST /sessions — creates a new session in Supabase, returns session_id
# WS /ws/{session_id} — main WebSocket for a live session. On connect, initializes audio, vision, coaching,
#     and qa pipelines. On disconnect, triggers post-session analysis and writes final metrics.
# GET /sessions/{id} — session data for the web dashboard
# GET /sessions — list all sessions for a user
# POST /sessions/{id}/report — triggers Claude Sonnet deep analysis, returns structured coaching report
# POST /files/upload — accepts a file upload, extracts text, chunks it, embeds it via OpenAI, stores vectors in Supabase pgvector
# DELETE /files/{id} — removes a file and its associated vectors from Supabase
# GET /files — lists all uploaded files for a user
