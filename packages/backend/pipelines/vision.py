# Receives base64-encoded video frames from the WebSocket handler. For each frame:
#
# - Decodes the base64 image
# - Runs MediaPipe Face Mesh to extract facial landmarks for all detected faces
# - Estimates head pose (yaw and pitch) from landmarks to detect looking away or down
# - Computes eye openness as an attentiveness proxy
#
# Every 3 seconds, aggregates across all detected faces and emits an AudienceSignal: attention_score (0–1),
# faces_detected, looking_away_pct. MediaPipe runs efficiently on Apple Silicon via its standard macOS build.
