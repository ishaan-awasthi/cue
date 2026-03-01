# The Q&A bail-out pipeline. Listens to the rolling transcript from audio.py.
# Uses a simple rule to detect a question: audience transcript segment ends with rising intonation or a "?"
# detected by Deepgram. When a question is detected:
#
# 1. Immediately fires a RAG lookup in rag.py (async, non-blocking)
# 2. Starts a timer
# 3. When the RAG result comes back, compares it against what the speaker has said since the question ended
#    using cosine similarity of OpenAI embeddings
# 4. If speaker response embedding similarity to the RAG answer is below QA_MATCH_THRESHOLD, OR the speaker
#    has said fewer than 10 words and QA_SILENCE_TIMEOUT_SECONDS has elapsed — whisper the answer via tts.py
# 5. If the speaker is already giving a sufficient answer, stay silent
#
# The intent: use the natural RAG latency as the grace period. By the time the answer arrives, we already know
# if the speaker needs help.
