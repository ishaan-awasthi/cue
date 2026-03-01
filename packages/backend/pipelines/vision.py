"""Vision pipeline.

Receives base64-encoded video frames from the WebSocket handler.
Uses MediaPipe FaceLandmarker (Tasks API, mediapipe >= 0.10) to detect faces,
estimate head pose (yaw/pitch) and eye openness for each detected face.

Every 3 seconds emits an AudienceSignal: attention_score (0–1),
faces_detected, looking_away_pct.

The face_landmarker.task model is downloaded automatically on first run.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Awaitable

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np

from ..db.models import AudienceSignal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

AudienceSignalCallback = Callable[[AudienceSignal], Awaitable[None]]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EMIT_INTERVAL = 3.0

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)
MODEL_PATH = Path(__file__).parent.parent / "models" / "face_landmarker.task"

YAW_THRESHOLD = 30.0
PITCH_THRESHOLD = 25.0
EYE_CLOSED_RATIO = 0.18

# Landmark indices (MediaPipe 478-point model)
_NOSE_TIP = 4
_CHIN = 152
_LEFT_EYE_OUTER = 263
_RIGHT_EYE_OUTER = 33
_LEFT_MOUTH = 287
_RIGHT_MOUTH = 57

_LEFT_EYE_TOP = 159
_LEFT_EYE_BOTTOM = 145
_LEFT_EYE_LEFT = 33
_LEFT_EYE_RIGHT = 133
_RIGHT_EYE_TOP = 386
_RIGHT_EYE_BOTTOM = 374
_RIGHT_EYE_LEFT = 362
_RIGHT_EYE_RIGHT = 263


def _ensure_model() -> str:
    """Download the face landmarker model if not already present."""
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.exists():
        logger.info("Downloading face_landmarker.task model (~29 MB)...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        logger.info("Downloaded to %s", MODEL_PATH)
    return str(MODEL_PATH)


class VisionPipeline:
    """Processes video frames and emits AudienceSignal periodically."""

    def __init__(self, session_id: str, on_signal: AudienceSignalCallback) -> None:
        self._session_id = session_id
        self._on_signal = on_signal
        self._frame_results: list[dict] = []
        self._running = False
        self._emit_task: asyncio.Task | None = None

        model_path = _ensure_model()
        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=20,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        self._frames_processed: int = 0
        print(f"[vision] FaceLandmarker loaded (model: {MODEL_PATH.name})")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        print(f"[vision] Starting VisionPipeline for session {self._session_id}")
        self._running = True
        self._emit_task = asyncio.create_task(self._emit_loop())

    async def push_frame(self, b64_frame: str) -> None:
        if not self._running:
            return
        try:
            img_bytes = base64.b64decode(b64_frame)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = self._landmarker.detect(mp_image)
            frame_data = self._analyze_result(result, frame.shape)
            self._frame_results.append(frame_data)
            self._frames_processed += 1
            if self._frames_processed == 1:
                print(f"[vision] First frame received ({frame.shape[1]}x{frame.shape[0]}) — face detection active")
            elif self._frames_processed % 30 == 0:
                faces = frame_data.get("faces", 0)
                looking_away = frame_data.get("looking_away", 0)
                print(f"[vision] Frame #{self._frames_processed}: {faces} face(s) detected, {looking_away} looking away")
        except Exception as exc:
            print(f"[vision] Frame processing error: {exc}")

    async def stop(self) -> None:
        self._running = False
        if self._emit_task:
            self._emit_task.cancel()
            try:
                await self._emit_task
            except asyncio.CancelledError:
                pass
        self._landmarker.close()

    # ------------------------------------------------------------------
    # Frame analysis
    # ------------------------------------------------------------------

    def _analyze_result(self, result, frame_shape: tuple) -> dict:
        if not result.face_landmarks:
            return {"faces": 0, "looking_away": 0}

        h, w, _ = frame_shape
        faces = 0
        looking_away = 0

        for face_landmarks in result.face_landmarks:
            faces += 1
            lm = face_landmarks  # list of NormalizedLandmark

            yaw, pitch = self._estimate_head_pose(lm, w, h)
            is_looking_away = abs(yaw) > YAW_THRESHOLD or abs(pitch) > PITCH_THRESHOLD

            left_ear = self._eye_aspect_ratio(
                lm, _LEFT_EYE_TOP, _LEFT_EYE_BOTTOM, _LEFT_EYE_LEFT, _LEFT_EYE_RIGHT, w, h
            )
            right_ear = self._eye_aspect_ratio(
                lm, _RIGHT_EYE_TOP, _RIGHT_EYE_BOTTOM, _RIGHT_EYE_LEFT, _RIGHT_EYE_RIGHT, w, h
            )
            eyes_closed = (left_ear + right_ear) / 2 < EYE_CLOSED_RATIO

            if is_looking_away or eyes_closed:
                looking_away += 1

        return {"faces": faces, "looking_away": looking_away}

    @staticmethod
    def _estimate_head_pose(lm, img_w: int, img_h: int) -> tuple[float, float]:
        model_points = np.array([
            (0.0, 0.0, 0.0),
            (0.0, -330.0, -65.0),
            (-225.0, 170.0, -135.0),
            (225.0, 170.0, -135.0),
            (-150.0, -150.0, -125.0),
            (150.0, -150.0, -125.0),
        ], dtype=np.float64)

        indices = [_NOSE_TIP, _CHIN, _LEFT_EYE_OUTER, _RIGHT_EYE_OUTER, _LEFT_MOUTH, _RIGHT_MOUTH]
        image_points = np.array(
            [(lm[i].x * img_w, lm[i].y * img_h) for i in indices],
            dtype=np.float64,
        )

        focal = img_w
        center = (img_w / 2, img_h / 2)
        camera_matrix = np.array(
            [[focal, 0, center[0]], [0, focal, center[1]], [0, 0, 1]],
            dtype=np.float64,
        )
        dist_coeffs = np.zeros((4, 1))

        success, rvec, _ = cv2.solvePnP(
            model_points, image_points, camera_matrix, dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not success:
            return 0.0, 0.0

        rmat, _ = cv2.Rodrigues(rvec)
        sy = np.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
        pitch = float(np.degrees(np.arctan2(-rmat[2, 0], sy)))
        yaw = float(np.degrees(np.arctan2(rmat[1, 0], rmat[0, 0]))) if sy > 1e-6 else 0.0
        return yaw, pitch

    @staticmethod
    def _eye_aspect_ratio(lm, top: int, bottom: int, left: int, right: int, w: int, h: int) -> float:
        def pt(i):
            return np.array([lm[i].x * w, lm[i].y * h])
        vertical = np.linalg.norm(pt(top) - pt(bottom))
        horizontal = np.linalg.norm(pt(left) - pt(right))
        return float(vertical / (horizontal + 1e-6))

    # ------------------------------------------------------------------
    # Emit loop
    # ------------------------------------------------------------------

    async def _emit_loop(self) -> None:
        while self._running:
            await asyncio.sleep(EMIT_INTERVAL)
            if not self._running:
                break
            frames = self._frame_results
            self._frame_results = []
            signal = self._aggregate(frames)
            print(
                f"[vision] AudienceSignal emitted — "
                f"faces={signal.faces_detected}, "
                f"attention={signal.attention_score:.3f}, "
                f"looking_away_pct={signal.looking_away_pct:.3f} "
                f"(from {len(frames)} frames)"
            )
            await self._on_signal(signal)

    def _aggregate(self, frames: list[dict]) -> AudienceSignal:
        if not frames:
            return AudienceSignal(
                attention_score=1.0,
                faces_detected=0,
                looking_away_pct=0.0,
                timestamp=datetime.now(timezone.utc),
            )
        total_faces = sum(f["faces"] for f in frames)
        total_looking_away = sum(f["looking_away"] for f in frames)
        avg_faces = total_faces / len(frames)
        looking_away_pct = (total_looking_away / total_faces) if total_faces > 0 else 0.0
        attention_score = max(0.0, 1.0 - looking_away_pct)
        return AudienceSignal(
            attention_score=round(attention_score, 3),
            faces_detected=round(avg_faces),
            looking_away_pct=round(looking_away_pct, 3),
            timestamp=datetime.now(timezone.utc),
        )
