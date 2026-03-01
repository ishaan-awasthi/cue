-- Dev seed data
-- Insert a test user, two sessions with events, metrics, a file, and placeholder chunks.

-- ------------------------------------------------------------------ user ---
INSERT INTO users (id, email, created_at) VALUES
    ('00000000-0000-0000-0000-000000000001', 'dev@example.com', NOW() - INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------- sessions ---
INSERT INTO sessions (id, user_id, started_at, ended_at, duration_seconds, overall_score, summary)
VALUES
    (
        '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days' + INTERVAL '22 minutes',
        1320,
        72.5,
        '{"avg_wpm": 138.4, "total_fillers": 14, "filler_rate_per_min": 0.64, "avg_pitch_variance": 120.3, "overall_score": 72.5}'
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '5 days',
        NOW() - INTERVAL '5 days' + INTERVAL '18 minutes',
        1080,
        65.0,
        '{"avg_wpm": 195.2, "total_fillers": 22, "filler_rate_per_min": 1.22, "avg_pitch_variance": 44.7, "overall_score": 65.0}'
    )
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------- session_events ---
-- Session 1 events
INSERT INTO session_events (id, session_id, timestamp, event_type, payload) VALUES
    (
        '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '30 seconds',
        'audio_signal',
        '{"transcript_chunk": "Good morning everyone, today we are going to talk about our Q3 results", "filler_word_count": 0, "words_per_minute": 142.0, "pitch_variance": 130.5, "volume_rms": 0.08, "timestamp": "2024-01-01T10:00:30Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '3 minutes',
        'audio_signal',
        '{"transcript_chunk": "um so uh basically what happened was that we, like, exceeded our targets", "filler_word_count": 4, "words_per_minute": 135.0, "pitch_variance": 110.2, "volume_rms": 0.07, "timestamp": "2024-01-01T10:03:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '4 minutes',
        'nudge',
        '{"text": "Try to cut the filler words — your audience notices more than you think.", "trigger_signal": "filler_word_rate", "trigger_value": 4.8, "timestamp": "2024-01-01T10:04:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000004',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '8 minutes',
        'audience_signal',
        '{"attention_score": 0.52, "faces_detected": 8, "looking_away_pct": 0.48, "timestamp": "2024-01-01T10:08:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000005',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '9 minutes',
        'nudge',
        '{"text": "Re-engage the room — you are losing them.", "trigger_signal": "attention_score", "trigger_value": 0.52, "timestamp": "2024-01-01T10:09:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000006',
        '10000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '2 days' + INTERVAL '15 minutes',
        'qa_event',
        '{"question_text": "What drove the revenue increase in Q3?", "answer_text": "The revenue increase was driven primarily by the new enterprise contracts signed in July and August, combined with a 12% uplift in renewals.", "speaker_response_text": "That is a great question, um, so basically", "similarity_score": 0.31, "whispered": true, "timestamp": "2024-01-01T10:15:00Z"}'
    );

-- Session 2 events
INSERT INTO session_events (id, session_id, timestamp, event_type, payload) VALUES
    (
        '20000000-0000-0000-0000-000000000010',
        '10000000-0000-0000-0000-000000000002',
        NOW() - INTERVAL '5 days' + INTERVAL '1 minute',
        'audio_signal',
        '{"transcript_chunk": "So the thing about this product is that it solves a really fundamental problem in the market", "filler_word_count": 1, "words_per_minute": 198.0, "pitch_variance": 42.1, "volume_rms": 0.09, "timestamp": "2024-01-01T09:01:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000011',
        '10000000-0000-0000-0000-000000000002',
        NOW() - INTERVAL '5 days' + INTERVAL '2 minutes',
        'nudge',
        '{"text": "Slow down — let the ideas land.", "trigger_signal": "words_per_minute", "trigger_value": 198.0, "timestamp": "2024-01-01T09:02:00Z"}'
    ),
    (
        '20000000-0000-0000-0000-000000000012',
        '10000000-0000-0000-0000-000000000002',
        NOW() - INTERVAL '5 days' + INTERVAL '5 minutes',
        'nudge',
        '{"text": "Vary your tone — a little inflection goes a long way.", "trigger_signal": "pitch_variance", "trigger_value": 44.7, "timestamp": "2024-01-01T09:05:00Z"}'
    );

-- ---------------------------------------------------------------- metrics ---
INSERT INTO metrics (user_id, session_id, metric_name, value, recorded_at) VALUES
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'avg_wpm',           138.4, NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'total_fillers',      14.0, NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'avg_pitch_variance', 120.3, NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'avg_volume_rms',     0.08, NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'overall_score',      72.5, NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'avg_wpm',            195.2, NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'total_fillers',      22.0, NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'avg_pitch_variance', 44.7, NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'avg_volume_rms',     0.09, NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'overall_score',      65.0, NOW() - INTERVAL '5 days');

-- -------------------------------------------------------- uploaded_files ---
INSERT INTO uploaded_files (id, user_id, filename, file_type, uploaded_at, chunk_count) VALUES
    (
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'Q3_Investor_Deck.pdf',
        'pdf',
        NOW() - INTERVAL '3 days',
        18
    )
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------- document_chunks ---
-- Placeholder chunks with zero-vector embeddings (for dev only — real embeddings
-- are generated by the backend on upload).
INSERT INTO document_chunks (id, file_id, user_id, chunk_text, chunk_index, embedding) VALUES
    (
        '40000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'Q3 revenue increased by 24% year-over-year, driven primarily by new enterprise contracts signed in July and August. Renewal rates improved to 89%, up from 77% in Q2.',
        0,
        array_fill(0.0::float, ARRAY[1536])::vector(1536)
    ),
    (
        '40000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'Operating expenses decreased by 8% due to the restructuring completed in June. Headcount was reduced by 12% while productivity per employee rose by 18%.',
        1,
        array_fill(0.0::float, ARRAY[1536])::vector(1536)
    ),
    (
        '40000000-0000-0000-0000-000000000003',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'Product roadmap for Q4 includes three major releases: the AI-powered analytics dashboard, the mobile companion app, and the expanded API for enterprise integrations.',
        2,
        array_fill(0.0::float, ARRAY[1536])::vector(1536)
    );
