"""Capture module.

Thread 1: reads frames from webcam via OpenCV, resizes to 640×480.
Thread 2: captures raw PCM audio from the default input device (AirPods) via
           pyaudio at 16 kHz, mono, 16-bit — the format Deepgram expects.

Both threads push data into a shared thread-safe queue consumed by ws_client.py.
No inference happens here.
"""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass

import cv2
import numpy as np
import pyaudio

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FRAME_WIDTH = 640
FRAME_HEIGHT = 480
TARGET_FPS = 5              # frames per second sent to backend

SAMPLE_RATE = 16_000        # Hz
CHANNELS = 1
SAMPLE_FORMAT = pyaudio.paInt16
CHUNK_SIZE = 1024           # PyAudio frames per read


# ---------------------------------------------------------------------------
# Queue item types
# ---------------------------------------------------------------------------

@dataclass
class VideoFrame:
    data: bytes     # JPEG-encoded frame bytes


@dataclass
class AudioChunk:
    data: bytes     # raw PCM int16 bytes


# ---------------------------------------------------------------------------
# Capture controller
# ---------------------------------------------------------------------------

class CaptureController:
    """Manages webcam and microphone capture threads."""

    def __init__(self) -> None:
        self.queue: queue.Queue[VideoFrame | AudioChunk] = queue.Queue(maxsize=200)
        self._stop_event = threading.Event()
        self._video_thread: threading.Thread | None = None
        self._audio_thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()
        self._video_thread = threading.Thread(target=self._video_loop, daemon=True, name="video-capture")
        self._audio_thread = threading.Thread(target=self._audio_loop, daemon=True, name="audio-capture")
        self._video_thread.start()
        self._audio_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._video_thread:
            self._video_thread.join(timeout=3)
        if self._audio_thread:
            self._audio_thread.join(timeout=3)

    # ------------------------------------------------------------------
    # Video loop
    # ------------------------------------------------------------------

    def _video_loop(self) -> None:
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            raise RuntimeError("Cannot open webcam at device index 0")

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)

        frame_interval = 1.0 / TARGET_FPS
        import time
        last_sent = 0.0

        try:
            while not self._stop_event.is_set():
                ret, frame = cap.read()
                if not ret:
                    continue

                now = time.monotonic()
                if now - last_sent < frame_interval:
                    continue
                last_sent = now

                # Resize to target resolution
                frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))

                # Encode as JPEG for compact transport
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                if ok:
                    try:
                        self.queue.put_nowait(VideoFrame(data=buf.tobytes()))
                    except queue.Full:
                        pass  # drop frame rather than block
        finally:
            cap.release()

    # ------------------------------------------------------------------
    # Audio loop
    # ------------------------------------------------------------------

    def _audio_loop(self) -> None:
        pa = pyaudio.PyAudio()
        stream = pa.open(
            format=SAMPLE_FORMAT,
            channels=CHANNELS,
            rate=SAMPLE_RATE,
            input=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        try:
            while not self._stop_event.is_set():
                pcm_bytes = stream.read(CHUNK_SIZE, exception_on_overflow=False)
                try:
                    self.queue.put_nowait(AudioChunk(data=pcm_bytes))
                except queue.Full:
                    pass  # drop rather than block
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()
