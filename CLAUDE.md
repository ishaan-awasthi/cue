# Cue — Real-time Presentation Coach

## What this is
Smart glasses system that coaches speakers in real-time. Three components:
- packages/glasses — webcam + audio capture, streams to backend
- packages/backend — FastAPI, runs all inference pipelines
- packages/web — Next.js dashboard for post-session review

## Stack
- STT: Deepgram (real-time streaming)
- TTS: Deepgram Aura
- Vision: MediaPipe Face Mesh
- Audio analysis: Deepgram + librosa
- Coaching: rules-based (coaching.py), transformer model for post-session only (models/fluency.py)
- Q&A bail-out: RAG via pgvector + OpenAI embeddings (text-embedding-3-small) + gpt-4o-mini answers
- DB: Supabase (Postgres + pgvector)
- Backend: FastAPI on Apple Silicon
- Frontend: Next.js + Tailwind + Recharts, deployed on Vercel

## Key architectural rules
- No inference runs on the glasses rig — capture only
- All DB access goes through db/queries.py — nothing else touches Supabase directly
- The fluency model runs on MPS (Apple Silicon GPU) via PyTorch — not during live sessions, post-session only
- coaching.py is rules-based only — no LLM calls during live sessions
- qa.py uses RAG latency as the grace period for floundering detection

## Hardware context
- Backend runs on Apple Silicon Mac — use MPS for PyTorch, standard mediapipe macOS build
- Glasses rig is a webcam attached to frames + AirPods for mic/speaker
- pyaudio captures at 16kHz mono 16-bit (Deepgram's expected format)

## Env vars
See .env.example for all required keys