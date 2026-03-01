# All Pydantic models used across the backend. Models:
#
# AudioSignal: transcript_chunk, filler_word_count, words_per_minute, pitch_variance, volume_rms, timestamp
# AudienceSignal: attention_score, faces_detected, looking_away_pct, timestamp
# Nudge: text, trigger_signal, trigger_value, timestamp
# QAEvent: question_text, answer_text, speaker_response_text, similarity_score, whispered (bool), timestamp
# Session: id, user_id, started_at, ended_at, duration_seconds, overall_score, summary
# SessionEvent: id, session_id, timestamp, event_type (audio_signal | audience_signal | nudge | qa_event), payload
# UserMetrics: id, user_id, session_id, metric_name, value, recorded_at
# DocumentChunk: id, user_id, file_id, chunk_text, chunk_index, embedding (vector)
# UploadedFile: id, user_id, filename, file_type, uploaded_at, chunk_count
