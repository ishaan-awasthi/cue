"""WebSocket client.

Drains the shared queue from capture.py and streams data to the FastAPI
backend over a single persistent WebSocket connection.

- Video frames are base64-encoded and sent as JSON: {"type": "frame", "data": "<b64>"}
- Audio is sent as raw binary WebSocket messages (bytes).

Also listens for incoming messages from the backend (Deepgram Aura TTS audio
for nudges or Q&A answers) and plays them through the default output device.

The backend sends a 4-byte sentinel (b"CUE!") before each new utterance so
the client can interrupt the current playback and start the new one.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import queue as _queue
import threading

import simpleaudio as sa
import websockets
from websockets.exceptions import ConnectionClosed

from .capture import AudioChunk, CaptureController, VideoFrame

# ---------------------------------------------------------------------------
# Configuration (from environment / defaults)
# ---------------------------------------------------------------------------

BACKEND_HOST = os.getenv("BACKEND_HOST", "localhost")
BACKEND_PORT = os.getenv("BACKEND_PORT", "8000")
USER_ID = os.getenv("USER_ID", "00000000-0000-0000-0000-000000000001")
SESSION_ID = os.getenv("SESSION_ID", "")

WS_URI_TEMPLATE = "ws://{host}:{port}/ws/{session_id}?user_id={user_id}"

RECONNECT_DELAY = 3.0      # seconds before reconnect attempt
MAX_RECONNECTS = 10

UTTERANCE_SENTINEL = b"CUE!"


# ---------------------------------------------------------------------------
# AudioPlayer — queued playback with utterance-level interruption
# ---------------------------------------------------------------------------

class AudioPlayer:
    """Accumulates streamed PCM chunks and plays complete utterances.

    When a new utterance sentinel arrives, any in-progress playback is
    interrupted so the new message is heard immediately.

    Uses a thread-safe queue.Queue so the async recv loop can feed data
    while the playback thread drains it.
    """

    def __init__(self) -> None:
        self._chunk_queue: _queue.Queue[bytes | None] = _queue.Queue(maxsize=500)
        self._playback_thread: threading.Thread | None = None
        self._current_play: sa.PlayObject | None = None
        self._stop_event = threading.Event()
        self._buffer = bytearray()
        self._lock = threading.Lock()

    def start(self) -> None:
        self._stop_event.clear()
        self._playback_thread = threading.Thread(
            target=self._playback_loop, daemon=True, name="audio-player",
        )
        self._playback_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._interrupt_current()
        try:
            self._chunk_queue.put_nowait(None)
        except _queue.Full:
            pass

    def enqueue(self, data: bytes) -> None:
        """Called from the async recv loop to feed data into the player."""
        try:
            self._chunk_queue.put_nowait(data)
        except _queue.Full:
            pass

    def _interrupt_current(self) -> None:
        with self._lock:
            if self._current_play and self._current_play.is_playing():
                self._current_play.stop()
                self._current_play = None

    def _play_buffer(self) -> None:
        with self._lock:
            if not self._buffer:
                return
            pcm = bytes(self._buffer)
            self._buffer.clear()

        try:
            wave_obj = sa.WaveObject(
                pcm, num_channels=1, bytes_per_sample=2, sample_rate=24000,
            )
            play_obj = wave_obj.play()
            with self._lock:
                self._current_play = play_obj
            play_obj.wait_done()
        except Exception as exc:
            print(f"[AudioPlayer] Playback error: {exc}")
        finally:
            with self._lock:
                self._current_play = None

    def _playback_loop(self) -> None:
        """Runs in a dedicated thread. Drains the queue, accumulates PCM
        chunks into batches, and plays them. A short queue timeout (100 ms)
        triggers playback of whatever has been buffered so far, keeping
        latency low. Sentinels interrupt current playback and discard any
        stale buffered data so the new utterance starts immediately."""
        while not self._stop_event.is_set():
            try:
                data = self._chunk_queue.get(timeout=0.1)
            except _queue.Empty:
                # Queue drained — play whatever we've accumulated
                self._play_buffer()
                continue

            if data is None:
                self._play_buffer()
                break

            if data == UTTERANCE_SENTINEL:
                self._interrupt_current()
                with self._lock:
                    self._buffer.clear()
            else:
                with self._lock:
                    self._buffer.extend(data)

        self._play_buffer()


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

    player = AudioPlayer()
    player.start()

    reconnects = 0
    while reconnects < MAX_RECONNECTS:
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
                print("[ws_client] WebSocket connected")
                reconnects = 0

                send_task = asyncio.create_task(_send_loop(ws, controller.queue))
                recv_task = asyncio.create_task(_recv_loop(ws, player))

                done, pending = await asyncio.wait(
                    [send_task, recv_task],
                    return_when=asyncio.FIRST_EXCEPTION,
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    if task.exception():
                        raise task.exception()  # type: ignore[misc]

        except (ConnectionClosed, OSError, Exception) as exc:
            reconnects += 1
            print(f"[ws_client] Connection lost ({exc}). Reconnecting in {RECONNECT_DELAY}s "
                  f"(attempt {reconnects}/{MAX_RECONNECTS})...")
            await asyncio.sleep(RECONNECT_DELAY)

    print("[ws_client] Max reconnects reached — stopping.")
    player.stop()
    controller.stop()


async def _send_loop(
    ws: websockets.WebSocketClientProtocol,
    data_queue: "_queue.Queue[VideoFrame | AudioChunk]",
) -> None:
    loop = asyncio.get_running_loop()
    while True:
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


async def _recv_loop(ws: websockets.WebSocketClientProtocol, player: AudioPlayer) -> None:
    """Receive audio bytes from backend and feed them to the AudioPlayer."""
    async for message in ws:
        if isinstance(message, bytes) and message:
            player.enqueue(message)


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
