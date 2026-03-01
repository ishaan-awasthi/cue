"""Fluency model wrapper.

Wraps a locally-downloaded wav2vec2-based audio classification model for
speech fluency / confidence scoring.

Runs on Apple Silicon via PyTorch MPS backend (fallback: CPU).
NOT called during live sessions — only invoked during post-session report
generation (POST /sessions/{id}/report).
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

from ..config import settings

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000  # wav2vec2 expects 16 kHz


@lru_cache(maxsize=1)
def _load_model():
    """Load model and processor once, cached for the process lifetime."""
    from transformers import AutoProcessor, AutoModelForAudioClassification

    model_path = settings.FLUENCY_MODEL_PATH
    logger.info("Loading fluency model from %s", model_path)

    processor = AutoProcessor.from_pretrained(model_path)
    model = AutoModelForAudioClassification.from_pretrained(model_path)

    device = _get_device()
    model = model.to(device)
    model.eval()
    logger.info("Fluency model loaded on device: %s", device)
    return processor, model, device


def _get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def score_segment(audio_array: np.ndarray) -> dict[str, float]:
    """Score a segment of audio for fluency/confidence.

    Parameters
    ----------
    audio_array : np.ndarray
        1-D float32 array of audio samples at 16 kHz.

    Returns
    -------
    dict with keys:
        fluency_score  — 0.0 (disfluent) to 1.0 (fluent)
        confidence     — model softmax probability of the highest class
    """
    try:
        processor, model, device = _load_model()

        inputs = processor(
            audio_array,
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
            padding=True,
        )
        input_values = inputs.input_values.to(device)

        with torch.no_grad():
            logits = model(input_values).logits

        probs = torch.softmax(logits, dim=-1).squeeze().cpu().numpy()
        predicted_class = int(np.argmax(probs))
        confidence = float(probs[predicted_class])

        # Map label to a 0–1 fluency score.
        # Convention: class 0 = disfluent/low confidence, class 1 = fluent/confident.
        # If the model has different labels inspect model.config.id2label.
        id2label: dict = model.config.id2label
        label = id2label.get(predicted_class, str(predicted_class)).lower()

        if "fluent" in label or "confident" in label or "high" in label:
            fluency_score = confidence
        else:
            fluency_score = 1.0 - confidence

        return {
            "fluency_score": round(float(fluency_score), 4),
            "confidence": round(confidence, 4),
            "label": label,
        }
    except Exception as exc:
        logger.error("Fluency model inference failed: %s", exc)
        return {"fluency_score": 0.5, "confidence": 0.0, "label": "unknown"}


def score_transcript_segments(
    segments: list[dict],
) -> list[dict]:
    """Score multiple segments.

    Each segment dict should have at least:
        audio   : np.ndarray  (float32, 16 kHz)
        start   : float       (seconds)
        end     : float       (seconds)
        text    : str         (transcript text for the segment)

    Returns the same list with a 'fluency' key added to each segment.
    """
    scored = []
    for seg in segments:
        audio = seg.get("audio")
        result = {"fluency_score": 0.5, "confidence": 0.0, "label": "unknown"}
        if audio is not None and len(audio) > 0:
            result = score_segment(np.asarray(audio, dtype=np.float32))
        scored.append({**seg, "fluency": result})
    return scored
