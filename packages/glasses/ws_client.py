"""WebSocket client.

Drains the shared queue from capture.py and streams data to the FastAPI
backend over a single persistent WebSocket connection.

- Video frames are base64-encoded and sent as JSON: {"type": "frame", "data": "<b64>"}
- Audio is sent as raw binary WebSocket messages (bytes).

Also listens for incoming messages from the backend (ElevenLabs audio bytes
for nudges or Q&A answers) and plays them through the default output device.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import queue as _queue
import threading
import time

import simpleaudio as sa
import websockets
from websockets.exceptions import ConnectionClosed

from .capture import AudioChunk, CaptureController, VideoFrame

# ---------------------------------------------------------------------------
# Configuration (from environment / defaults)
# ---------------------------------------------------------------------------

BACKEND_HOST = os.getenv("BACKEND_HOST", "localhost")
BACKEND_PORT = os.getenv("BACKEND_PORT", "8000")
USER_ID = os.getenv("USER_ID", "dev-user")
SESSION_ID = os.getenv("SESSION_ID", "")

WS_URI_TEMPLATE = "ws://{host}:{port}/ws/{session_id}?user_id={user_id}"

RECONNECT_DELAY = 3.0      # seconds before reconnect attempt
MAX_RECONNECTS = 10


# ---------------------------------------------------------------------------
# Playback helper
# ---------------------------------------------------------------------------

def _play_audio_bytes(audio_bytes: bytes) -> None:
    """Play MP3/WAV bytes through the default output device using simpleaudio.

    simpleaudio expects PCM WAV.  If ElevenLabs returns MP3, we decode it
    first via the `pydub` library (optional dependency).
    """
    try:
        # Try decoding as MP3 → PCM via pydub if available
        try:
            from pydub import AudioSegment
            import io
            seg = AudioSegment.from_file(io.BytesIO(audio_bytes), format="mp3")
            pcm = seg.raw_data
            wave_obj = sa.WaveObject(pcm, seg.channels, seg.sample_width, seg.frame_rate)
        except Exception:
            # Assume raw PCM 16-bit mono 24 kHz (ElevenLabs output)
            wave_obj = sa.WaveObject(audio_bytes, 1, 2, 24000)

        play_obj = wave_obj.play()
        play_obj.wait_done()
    except Exception as exc:
        print(f"[ws_client] Audio playback error: {exc}")


# ---------------------------------------------------------------------------
# Main client
# ---------------------------------------------------------------------------

async def run(session_id: str, user_id: str) -> None:
    uri = WS_URI_TEMPLATE.format(
        host=BACKEND_HOST,
        port=BACKEND_PORT,
        session_id=session_id,
        user_id=user_id,
    )
    print(f"[ws_client] Connecting to {uri}")

    controller = CaptureController()
    controller.start()
    print("[ws_client] Capture started (webcam + mic)")

    reconnects = 0
    while reconnects < MAX_RECONNECTS:
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
                print("[ws_client] WebSocket connected")
                reconnects = 0  # reset on successful connection

                # Task 1: drain queue and send to backend
                send_task = asyncio.create_task(_send_loop(ws, controller.queue))
                # Task 2: receive nudge/answer audio from backend
                recv_task = asyncio.create_task(_recv_loop(ws))

                done, pending = await asyncio.wait(
                    [send_task, recv_task],
                    return_when=asyncio.FIRST_EXCEPTION,
                )
                for task in pending:
                    task.cancel()
                # Re-raise any exception
                for task in done:
                    if task.exception():
                        raise task.exception()  # type: ignore[misc]

        except (ConnectionClosed, OSError, Exception) as exc:
            reconnects += 1
            print(f"[ws_client] Connection lost ({exc}). Reconnecting in {RECONNECT_DELAY}s "
                  f"(attempt {reconnects}/{MAX_RECONNECTS})...")
            await asyncio.sleep(RECONNECT_DELAY)

    print("[ws_client] Max reconnects reached — stopping.")
    controller.stop()


async def _send_loop(
    ws: websockets.WebSocketClientProtocol,
    data_queue: "_queue.Queue[VideoFrame | AudioChunk]",
) -> None:
    loop = asyncio.get_running_loop()
    while True:
        # Non-blocking queue drain in a thread-pool so we don't block the event loop
        try:
            item = await loop.run_in_executor(None, _blocking_get, data_queue)
        except Exception:
            await asyncio.sleep(0.005)
            continue

        if isinstance(item, AudioChunk):
            await ws.send(item.data)
        elif isinstance(item, VideoFrame):
            b64 = base64.b64encode(item.data).decode("ascii")
            msg = json.dumps({"type": "frame", "data": b64})
            await ws.send(msg)


def _blocking_get(q: "_queue.Queue") -> "VideoFrame | AudioChunk":
    return q.get(timeout=0.1)


async def _recv_loop(ws: websockets.WebSocketClientProtocol) -> None:
    """Receive audio bytes from backend and play them."""
    async for message in ws:
        if isinstance(message, bytes) and message:
            # Run playback in a thread so it doesn't block the event loop
            asyncio.get_running_loop().run_in_executor(None, _play_audio_bytes, message)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import sys

    sid = SESSION_ID or os.getenv("SESSION_ID")
    if not sid:
        print("Error: SESSION_ID environment variable is required.")
        sys.exit(1)

    uid = USER_ID or os.getenv("USER_ID", "dev-user")
    asyncio.run(run(session_id=sid, user_id=uid))


if __name__ == "__main__":
    main()
