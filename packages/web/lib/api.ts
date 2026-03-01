// Typed fetch wrapper for FastAPI backend calls. Base URL from NEXT_PUBLIC_API_URL.
// Functions: createSession(), getSessionReport(id), uploadFile(file), deleteFile(id).
// Most reads go through Supabase directly — this file handles writes and operations requiring backend logic.
