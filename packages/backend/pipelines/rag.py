# The retrieval pipeline for the Q&A feature. Given a question string:
#
# - Embeds the question using OpenAI text-embedding-3-small
# - Queries the Supabase pgvector table (document_chunks) using cosine similarity search to find the top 3
#   most relevant chunks from the user's uploaded files
# - Passes the question + retrieved chunks to Claude Haiku with a prompt asking for a concise 1-3 sentence
#   answer suitable for whispering
# - Returns the answer string to qa.py
#
# Also used during file upload: when a file is uploaded via POST /files/upload, rag.py handles chunking the
# extracted text into ~500 token chunks, embedding each chunk via OpenAI, and storing chunks + vectors in Supabase.
