# Backend models

This directory contains local transformer model wrappers. The fluency model weights are **not** committed to the repo — they must be downloaded separately.

- **Model:** facebook/wav2vec2-base (or a fine-tuned variant) for fluency scoring.
- **HuggingFace:** Use the model ID and download weights into this directory (or set `FLUENCY_MODEL_PATH` in `.env`).
- **Apple Silicon:** Models run via PyTorch with the MPS backend when available; otherwise CPU.
