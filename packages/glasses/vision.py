"""Glasses-side vision pipeline.

Runs MediaPipe Face Mesh locally to detect whether the speaker is attentive
(head pose + eye aspect ratio + iris gaze). Produces SpeakerSignal items in
a queue that ws_client.py forwards to the backend as JSON.

No raw video frames are ever sent to the backend.
"""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass

import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import numpy as np
from scipy.spatial import distance

from .capture import WEBCAM_INDEX

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)
_MODEL_PATH = Path(__file__).parent / "face_landmarker.task"


def _ensure_model() -> str:
    if not _MODEL_PATH.exists():
        # print("[vision] Downloading face_landmarker.task model (~29 MB)...")
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
        # print(f"[vision] Downloaded to {_MODEL_PATH}")
    return str(_MODEL_PATH)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HEAD_ANGLE_THRESHOLD = 15
EAR_THRESHOLD = 0.20
DISTRACTION_SECONDS = 3

_LEFT_EYE  = [33, 160, 158, 133, 153, 144]
_RIGHT_EYE = [362, 385, 387, 263, 373, 380]


# ---------------------------------------------------------------------------
# Queue item
# ---------------------------------------------------------------------------

@dataclass
class SpeakerSignal:
    attentive: bool
    head_x: float
    head_y: float
    ear: float
    gaze_centered: bool


# ---------------------------------------------------------------------------
# Helpers (ported directly from temp.py)
# ---------------------------------------------------------------------------

def _eye_aspect_ratio(landmarks, eye_indices: list[int]) -> float:
    pts = [np.array([landmarks[i].x, landmarks[i].y]) for i in eye_indices]
    p1, p2, p3, p4, p5, p6 = pts
    vertical1 = distance.euclidean(p2, p6)
    vertical2 = distance.euclidean(p3, p5)
    horizontal = distance.euclidean(p1, p4)
    return (vertical1 + vertical2) / (2.0 * horizontal)


def _get_head_pose(frame, landmarks) -> tuple[float, float]:
    h, w, _ = frame.shape
    face_2d, face_3d = [], []
    for idx in [1, 33, 61, 152, 263, 291]:
        lm = landmarks[idx]
        x, y = int(lm.x * w), int(lm.y * h)
        face_2d.append([x, y])
        face_3d.append([x, y, lm.z])
    face_2d = np.array(face_2d, dtype=np.float64)
    face_3d = np.array(face_3d, dtype=np.float64)
    focal_length = w
    cam_matrix = np.array([
        [focal_length, 0, w / 2],
        [0, focal_length, h / 2],
        [0, 0, 1],
    ])
    _, rot_vec, _ = cv2.solvePnP(face_3d, face_2d, cam_matrix, np.zeros((4, 1)))
    rmat, _ = cv2.Rodrigues(rot_vec)
    angles, *_ = cv2.RQDecomp3x3(rmat)
    return angles[0] * 360, angles[1] * 360


def _gaze_forward(landmarks, frame_width: int) -> bool:
    outer = landmarks[33].x * frame_width
    inner = landmarks[133].x * frame_width
    iris  = landmarks[468].x * frame_width
    ratio = (iris - outer) / (inner - outer)
    return 0.35 < ratio < 0.65


# ---------------------------------------------------------------------------
# Vision controller
# ---------------------------------------------------------------------------

class SpeakerVision:
    """Captures webcam and runs Face Mesh locally to emit SpeakerSignal items."""

    def __init__(self) -> None:
        self.queue: queue.Queue[SpeakerSignal] = queue.Queue(maxsize=100)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="speaker-vision")
        self._thread.start()
        # print("[vision] SpeakerVision thread started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        model_path = _ensure_model()
        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        landmarker = mp_vision.FaceLandmarker.create_from_options(options)

        cap = cv2.VideoCapture(WEBCAM_INDEX)
        if not cap.isOpened():
            # print(f"[vision] Cannot open webcam at index {WEBCAM_INDEX}")
            landmarker.close()
            return

        not_attentive_start: float | None = None
        frames_processed = 0
        # print("[vision] Webcam opened — running Face Mesh")

        try:
            while not self._stop_event.is_set():
                ret, frame = cap.read()
                if not ret:
                    continue

                frame = cv2.flip(frame, 1)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect(mp_image)

                if not result.face_landmarks:
                    continue

                landmarks = result.face_landmarks[0]
                _, w, _ = frame.shape

                x_angle, y_angle = _get_head_pose(frame, landmarks)
                head_forward = (
                    abs(x_angle) < HEAD_ANGLE_THRESHOLD
                    and abs(y_angle) < HEAD_ANGLE_THRESHOLD
                )

                ear = (
                    _eye_aspect_ratio(landmarks, _LEFT_EYE)
                    + _eye_aspect_ratio(landmarks, _RIGHT_EYE)
                ) / 2.0
                eyes_open = ear > EAR_THRESHOLD

                gaze_centered = _gaze_forward(landmarks, w)

                raw_attentive = head_forward and eyes_open and gaze_centered

                # 3-second sustained-inattention grace period (from temp.py)
                if not raw_attentive:
                    if not_attentive_start is None:
                        not_attentive_start = time.time()
                    attentive = (time.time() - not_attentive_start) <= DISTRACTION_SECONDS
                else:
                    not_attentive_start = None
                    attentive = True

                frames_processed += 1
                if frames_processed == 1:
                    print("[vision] First face detected — speaker attention tracking active")
                elif frames_processed % 150 == 0:
                    print(
                        f"[vision] Frame #{frames_processed}: "
                        f"attentive={attentive}, ear={ear:.3f}, "
                        f"head=({x_angle:.1f}, {y_angle:.1f})"
                    )

                sig = SpeakerSignal(
                    attentive=attentive,
                    head_x=round(x_angle, 2),
                    head_y=round(y_angle, 2),
                    ear=round(ear, 4),
                    gaze_centered=gaze_centered,
                )
                try:
                    self.queue.put_nowait(sig)
                except queue.Full:
                    pass  # drop rather than block
        finally:
            cap.release()
            landmarker.close()
