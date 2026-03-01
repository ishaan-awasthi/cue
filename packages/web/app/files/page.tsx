// File management page. Lists all uploaded reference files from Supabase. Allows uploading new files
// via FileUploader component — supports PDF, PPTX, DOCX, TXT, MD. On upload, calls POST /files/upload
// which extracts text, chunks it, embeds it, and stores vectors in Supabase pgvector. Allows deleting
// files. Shows chunk count per file so the user knows how much of each file was indexed. Explains to
// the user that these files are used during live Q&A to whisper answers.
