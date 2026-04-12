-- Replace match_chunks to join document_chunks with uploaded_files and return filename.
-- Used by RAG pipeline for sources_used in QAEvent without a second query.

DROP FUNCTION IF EXISTS match_chunks(vector(1536), UUID, INT);

CREATE OR REPLACE FUNCTION match_chunks(
    query_embedding  vector(1536),
    match_user_id    UUID,
    match_count      INT DEFAULT 3
)
RETURNS TABLE (
    id          UUID,
    file_id     UUID,
    user_id     UUID,
    chunk_text  TEXT,
    chunk_index INT,
    embedding   vector(1536),
    similarity  FLOAT,
    filename    TEXT
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
        uf.filename
    FROM document_chunks dc
    JOIN uploaded_files uf ON dc.file_id = uf.id
    WHERE dc.user_id = match_user_id
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
