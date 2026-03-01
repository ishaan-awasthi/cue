# All Supabase read/write logic. Nothing else in the codebase touches Supabase directly. Functions:
#
# create_session(user_id) → Session
# end_session(session_id, metrics) → Session
# insert_event(session_id, event_type, payload) → SessionEvent
# get_session(session_id) → Session
# list_sessions(user_id) → list[Session]
# get_session_events(session_id) → list[SessionEvent]
# upsert_metrics(session_id, user_id, metrics_dict)
# insert_file(user_id, filename, file_type) → UploadedFile
# insert_chunk(file_id, user_id, chunk_text, chunk_index, embedding_vector) → DocumentChunk
# similarity_search(user_id, query_embedding, top_k=3) → list[DocumentChunk] — uses pgvector cosine similarity operator (<=>)
# delete_file(file_id) — deletes file record and all associated chunks
# list_files(user_id) → list[UploadedFile]
