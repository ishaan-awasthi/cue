# Reads from the shared queue populated by capture.py and streams data to the FastAPI backend over a single
# persistent WebSocket connection. Video frames are base64-encoded before sending, tagged with type "frame".
# Audio is sent as raw PCM bytes, tagged with type "audio".
# Also listens for incoming messages from the backend — these will be either nudge audio bytes or Q&A answer
# audio bytes from ElevenLabs — and plays them immediately through the default output device (e.g. AirPods).
# This is the only file in the glasses package that requires a network connection.
