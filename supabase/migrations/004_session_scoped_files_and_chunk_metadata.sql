-- Session-scoped files + processing status + chunk metadata.
-- Also updates match_chunks RPC for strict session retrieval.

ALTER TABLE uploaded_files
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE uploaded_files
ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE uploaded_files
ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'uploaded'
CHECK (processing_status IN ('uploaded', 'parsing', 'embedded', 'ready', 'failed'));

ALTER TABLE uploaded_files
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE uploaded_files
ADD COLUMN IF NOT EXISTS failed_reason TEXT;

CREATE INDEX IF NOT EXISTS uploaded_files_session_id_idx ON uploaded_files(session_id);
CREATE INDEX IF NOT EXISTS uploaded_files_status_idx ON uploaded_files(processing_status);

ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP FUNCTION IF EXISTS match_chunks(vector(1536), UUID, INT);
DROP FUNCTION IF EXISTS match_chunks(vector(1536), UUID, INT, UUID);

CREATE OR REPLACE FUNCTION match_chunks(
    query_embedding  vector(1536),
    match_user_id    UUID,
    match_count      INT DEFAULT 3,
    match_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id          UUID,
    file_id     UUID,
    user_id     UUID,
    chunk_text  TEXT,
    chunk_index INT,
    embedding   vector(1536),
    similarity  FLOAT,
    filename    TEXT,
    metadata    JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.file_id,
        dc.user_id,
        dc.chunk_text,
        dc.chunk_index,
        dc.embedding,
        1 - (dc.embedding <=> query_embedding) AS similarity,
        uf.filename,
        dc.metadata
    FROM document_chunks dc
    JOIN uploaded_files uf ON dc.file_id = uf.id
    WHERE dc.user_id = match_user_id
      AND uf.processing_status = 'ready'
      AND (match_session_id IS NULL OR uf.session_id = match_session_id)
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
