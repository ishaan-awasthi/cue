# Calls ElevenLabs API with a given text string and ELEVENLABS_VOICE_ID. Returns raw audio bytes.
# For nudges, uses a calm, quiet voice setting appropriate for whispering into an earpiece.
# Called by both coaching.py (nudges) and qa.py (answer delivery).
# Note: consider using ElevenLabs streaming endpoint for lower latency on longer Q&A answers.
