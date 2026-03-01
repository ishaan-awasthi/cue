-- pgvector extension and document_chunks table
-- NOTE: Enable the pgvector extension in the Supabase dashboard under
--       Database → Extensions before running this migration.

CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------- document_chunks ---
CREATE TABLE IF NOT EXISTS document_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id     UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_text  TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    embedding   vector(1536)    -- OpenAI text-embedding-3-small output dimension
);

-- HNSW index for fast approximate cosine similarity search
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS document_chunks_file_id_idx ON document_chunks(file_id);

-- ----------------------------------------------------------- match_chunks ---
-- RPC called by queries.similarity_search().
-- Returns the top `match_count` chunks for a given user ordered by cosine
-- similarity to `query_embedding`.
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
    similarity  FLOAT
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
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM document_chunks dc
    WHERE dc.user_id = match_user_id
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
