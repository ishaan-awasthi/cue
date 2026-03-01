"""Capture module.

Captures raw PCM audio from the default input device (AirPods) via pyaudio
at 16 kHz, mono, 16-bit — the format Deepgram expects.

Pushes AudioChunk items into a thread-safe queue consumed by ws_client.py.
Video capture and vision processing are handled by vision.py.
"""

from __future__ import annotations

import os
import queue
import threading
from dataclasses import dataclass

import pyaudio

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16_000        # Hz
CHANNELS = 1
SAMPLE_FORMAT = pyaudio.paInt16
CHUNK_SIZE = 1024           # PyAudio frames per read

# Device selection — override via env vars if you need a specific device.
# Leave unset to use the macOS system default for each.
# Run `python3 -m packages.glasses.capture --list-devices` to see available devices.
_WEBCAM_INDEX_ENV = os.getenv("WEBCAM_INDEX")
_AUDIO_INPUT_INDEX_ENV = os.getenv("AUDIO_INPUT_INDEX")

WEBCAM_INDEX: int = int(_WEBCAM_INDEX_ENV) if _WEBCAM_INDEX_ENV is not None else 0
AUDIO_INPUT_INDEX: int | None = int(_AUDIO_INPUT_INDEX_ENV) if _AUDIO_INPUT_INDEX_ENV is not None else None


# ---------------------------------------------------------------------------
# Queue item types
# ---------------------------------------------------------------------------

@dataclass
class AudioChunk:
    data: bytes     # raw PCM int16 bytes


# ---------------------------------------------------------------------------
# Capture controller
# ---------------------------------------------------------------------------

class CaptureController:
    """Manages microphone capture thread."""

    def __init__(self) -> None:
        self.queue: queue.Queue[AudioChunk] = queue.Queue(maxsize=200)
        self._stop_event = threading.Event()
        self._audio_thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()
        self._audio_thread = threading.Thread(target=self._audio_loop, daemon=True, name="audio-capture")
        self._audio_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._audio_thread:
            self._audio_thread.join(timeout=3)

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
            input_device_index=AUDIO_INPUT_INDEX,  # None = system default
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


# ---------------------------------------------------------------------------
# Device listing helper
# ---------------------------------------------------------------------------

def list_devices() -> None:
    """Print available audio devices."""
    print("=== Audio input devices ===")
    pa = pyaudio.PyAudio()
    default_input = pa.get_default_input_device_info()["index"]
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if info["maxInputChannels"] > 0:
            marker = " ← default" if i == default_input else ""
            print(f"  [{i}] {info['name']}{marker}")
    print("\n=== Audio output devices ===")
    default_output = pa.get_default_output_device_info()["index"]
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if info["maxOutputChannels"] > 0:
            marker = " ← default" if i == default_output else ""
            print(f"  [{i}] {info['name']}{marker}")
    pa.terminate()
    print(f"\nTo override: WEBCAM_INDEX=<n> AUDIO_INPUT_INDEX=<n> ./scripts/start_rig.sh")


if __name__ == "__main__":
    import sys
    if "--list-devices" in sys.argv:
        list_devices()
    else:
        print("Usage: python3 -m packages.glasses.capture --list-devices")
