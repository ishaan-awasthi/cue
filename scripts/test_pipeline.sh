#!/usr/bin/env bash
# End-to-end test without hardware.
# Sends pre-recorded audio and video frames from tests/fixtures to the backend
# over WebSocket and verifies that at least one nudge or Q&A whisper is received
# within 60 seconds.
#
# Usage: ./scripts/test_pipeline.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES_DIR="$REPO_ROOT/tests/fixtures"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
USER_ID="${USER_ID:-00000000-0000-0000-0000-000000000001}"

# Load env vars
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

echo "==> Creating test session..."
SESSION_RESPONSE=$(curl -s -X POST "$BACKEND_URL/sessions" \
  -H "X-User-Id: $USER_ID")
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
echo "    Session ID: $SESSION_ID"

WS_URL="ws://$(echo "$BACKEND_URL" | sed 's|http://||')/ws/$SESSION_ID?user_id=$USER_ID"
echo "==> Connecting to $WS_URL"

echo "==> Running pipeline test (60s timeout)..."
python3 - <<PYEOF
import asyncio
import base64
import json
import os
import pathlib
import sys

import websockets

FIXTURES = pathlib.Path("$FIXTURES_DIR")
WS_URL = "$WS_URL"
TIMEOUT = 60

async def run():
    received_audio = False

    # Load test fixtures (fall back to synthetic data if not present)
    audio_fixture = FIXTURES / "sample_speech.pcm"
    frame_fixture = FIXTURES / "sample_frame.jpg"

    if audio_fixture.exists():
        audio_data = audio_fixture.read_bytes()
    else:
        # 5 seconds of silence (16kHz, 16-bit, mono)
        import numpy as np
        silence = (np.zeros(16000 * 5, dtype=np.int16)).tobytes()
        audio_data = silence

    if frame_fixture.exists():
        frame_data = base64.b64encode(frame_fixture.read_bytes()).decode()
    else:
        # 1x1 black JPEG
        frame_data = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k="

    async with websockets.connect(WS_URL, ping_interval=20) as ws:
        print("  Connected. Sending test data...", flush=True)

        async def send_data():
            # Send 30 chunks of audio (30 * 1024 bytes each, ~1.9s each)
            chunk_size = 1024 * 16  # 1024 samples at 16kHz
            for i in range(30):
                start = (i * chunk_size) % max(len(audio_data) - chunk_size, 1)
                chunk = audio_data[start:start + chunk_size]
                if len(chunk) < chunk_size:
                    import numpy as np
                    pad = bytes(chunk_size - len(chunk))
                    chunk = chunk + pad
                await ws.send(chunk)

                # Send a frame every 3rd audio chunk
                if i % 3 == 0:
                    await ws.send(json.dumps({"type": "frame", "data": frame_data}))

                await asyncio.sleep(0.1)

        async def recv_data():
            nonlocal received_audio
            async for msg in ws:
                if isinstance(msg, bytes) and len(msg) > 0:
                    print(f"  ✓ Received audio response ({len(msg)} bytes) — nudge or Q&A answer delivered!", flush=True)
                    received_audio = True
                    return

        try:
            await asyncio.wait_for(
                asyncio.gather(send_data(), recv_data()),
                timeout=TIMEOUT,
            )
        except asyncio.TimeoutError:
            pass

    return received_audio

result = asyncio.run(run())
if result:
    print("PASS: Pipeline delivered at least one audio nudge/answer.")
    sys.exit(0)
else:
    print("FAIL: No audio response received within ${TIMEOUT}s.")
    print("      Check that the backend is running and thresholds are reachable with test data.")
    sys.exit(1)
PYEOF
