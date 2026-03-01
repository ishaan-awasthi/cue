#!/usr/bin/env bash
# Start the FastAPI backend with hot-reload.
# Usage: ./scripts/start_backend.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Load env vars
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

# Verify fluency model is present
FLUENCY_PATH="${FLUENCY_MODEL_PATH:-./models/fluency-model}"
if [ ! -d "$REPO_ROOT/packages/backend/$FLUENCY_PATH" ] && [ ! -d "$FLUENCY_PATH" ]; then
  echo "WARNING: Fluency model not found at $FLUENCY_PATH"
  echo "  Post-session reports will fail until the model is downloaded."
  echo "  See packages/backend/models/README.md for instructions."
fi

echo "Starting Cue backend on http://0.0.0.0:8000"
echo "WebSocket URL for glasses rig: ws://$(ipconfig getifaddr en0 2>/dev/null || hostname):8000/ws/<session_id>"
echo ""

cd "$REPO_ROOT"
python -m uvicorn packages.backend.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --reload-dir "$REPO_ROOT/packages/backend"
