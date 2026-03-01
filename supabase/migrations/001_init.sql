-- Core schema

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------ users ---
CREATE TABLE IF NOT EXISTS users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------- sessions ---
CREATE TABLE IF NOT EXISTS sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,
    duration_seconds INTEGER,
    overall_score    FLOAT,
    summary          JSONB
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

-- --------------------------------------------------------- session_events ---
-- Append-only event log. Never UPDATE or DELETE rows in this table.
CREATE TABLE IF NOT EXISTS session_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'audio_signal',
        'audience_signal',
        'nudge',
        'qa_event'
    )),
    payload    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS session_events_session_id_idx ON session_events(session_id);
CREATE INDEX IF NOT EXISTS session_events_timestamp_idx  ON session_events(timestamp);

-- ---------------------------------------------------------------- metrics ---
CREATE TABLE IF NOT EXISTS metrics (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    metric_name  TEXT NOT NULL,
    value        FLOAT NOT NULL,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS metrics_user_metric_idx ON metrics(user_id, metric_name);
CREATE INDEX IF NOT EXISTS metrics_session_id_idx  ON metrics(session_id);

-- -------------------------------------------------------- uploaded_files ---
CREATE TABLE IF NOT EXISTS uploaded_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    file_type   TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chunk_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS uploaded_files_user_id_idx ON uploaded_files(user_id);

-- ------------------------------------------------- increment_chunk_count ---
-- Helper RPC used by queries.py when inserting document chunks.
CREATE OR REPLACE FUNCTION increment_chunk_count(file_id_arg UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE uploaded_files
    SET chunk_count = chunk_count + 1
    WHERE id = file_id_arg;
END;
$$;
