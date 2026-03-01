#!/usr/bin/env bash
# Start the glasses rig (webcam + mic capture → WebSocket stream).
# Usage: SESSION_ID=<uuid> ./scripts/start_rig.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load env vars
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

# Require SESSION_ID
if [ -z "${SESSION_ID:-}" ]; then
  echo "Error: SESSION_ID environment variable is required."
  echo "  Create a session first via: POST http://localhost:8000/sessions"
  echo "  Then run: SESSION_ID=<uuid> ./scripts/start_rig.sh"
  exit 1
fi

# Check webcam is accessible
if ! python3 -c "import cv2; cap = cv2.VideoCapture(0); assert cap.isOpened(), 'Webcam not found'; cap.release()" 2>/dev/null; then
  echo "Error: Cannot open webcam at device index 0."
  echo "  Check that your webcam is connected and not in use by another app."
  exit 1
fi

# Check microphone is accessible
if ! python3 -c "import pyaudio; pa = pyaudio.PyAudio(); pa.get_default_input_device_info(); pa.terminate()" 2>/dev/null; then
  echo "Error: Cannot open microphone input device."
  echo "  Check that your AirPods or another audio input is connected."
  exit 1
fi

BACKEND_HOST="${BACKEND_HOST:-localhost}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
echo "Connecting to backend at ws://$BACKEND_HOST:$BACKEND_PORT/ws/$SESSION_ID"
echo "Webcam index:      ${WEBCAM_INDEX:-0 (default)}"
echo "Audio input index: ${AUDIO_INPUT_INDEX:-(system default)}"
echo "Audio output:      system default"
echo "(run 'python3 -m packages.glasses.capture --list-devices' to see all devices)"
echo ""

cd "$REPO_ROOT"
SESSION_ID="$SESSION_ID" \
USER_ID="${USER_ID:-00000000-0000-0000-0000-000000000001}" \
BACKEND_HOST="$BACKEND_HOST" \
BACKEND_PORT="$BACKEND_PORT" \
python3 -m packages.glasses.ws_client
