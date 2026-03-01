# Receives raw PCM audio chunks from the WebSocket handler. Does two things in parallel:
#
# 1. Streams audio to Deepgram's real-time WebSocket API. Deepgram returns word-level transcripts with timestamps,
#    filler word flags (uh, um, like, you know), and speaking pace in words per minute.
# 2. Buffers audio chunks and periodically runs librosa on the buffer to extract pitch variance and volume (RMS energy).
#    librosa runs on Apple Silicon via the default numpy/scipy stack — no special Metal acceleration needed.
#
# Every 5 seconds, emits an AudioSignal object (defined in db/models.py) to the coaching pipeline and the qa pipeline.
# Also emits the raw rolling transcript separately to qa.py for question detection.
