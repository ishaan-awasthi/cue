# The rules-based coaching engine. Subscribes to AudioSignal and AudienceSignal events.
# Maintains a rolling 30-second window of signal history. Every NUDGE_INTERVAL_SECONDS, checks thresholds:
#
# - filler_word_rate > FILLER_WORD_RATE_THRESHOLD → nudge: "watch your filler words"
# - attention_score < ATTENTION_THRESHOLD → nudge: "re-engage the room"
# - words_per_minute < 100 → nudge: "pick up the pace"
# - words_per_minute > 180 → nudge: "slow down"
# - volume_rms below threshold for extended period → nudge: "speak up"
# - pitch_variance near zero for extended period → nudge: "vary your tone"
#
# If a threshold is crossed, sends the nudge text to tts.py, gets back audio bytes, and sends them over WebSocket
# to the glasses rig. Also writes every signal snapshot and every nudge as a session_event to Supabase via db/queries.py.
# Does NOT use an LLM — all logic is explicit rules. The transformer model (models/fluency.py) is used here only
# for post-session analysis, not live nudges.
