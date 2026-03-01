# Cue

Cue is a real-time presentation coaching system using smart glasses. It helps speakers improve by capturing their delivery and audience attention, delivering live nudges via earpiece, and whispering Q&A answers from uploaded reference materials when needed.

## Components

1. **Glasses rig** — Captures webcam video and microphone audio (e.g. from AirPods). Streams both over a single WebSocket to the backend. Receives and plays nudge and Q&A answer audio from the backend. No inference runs on the rig; it is capture and playback only.

2. **Backend** — FastAPI service that runs inference pipelines: real-time speech (Deepgram STT, filler words, pace), vision (MediaPipe face/attention), rules-based coaching (nudges), and Q&A (RAG + whisper). Writes sessions and events to Supabase. Serves the WebSocket for the glasses and REST endpoints for the web app and report generation.

3. **Web dashboard** — Next.js app for post-session review and file management. View past sessions, transcripts, nudge timelines, metrics charts, attention heatmaps, and coaching reports. Manage uploaded reference files used by the RAG Q&A system.

4. **RAG Q&A system** — During live Q&A, when the system detects an audience question, it looks up relevant chunks from the user’s uploaded files (PDF, PPTX, DOCX, etc.) via embeddings and pgvector. If the speaker’s response is insufficient or too slow, the system whispers a short answer through the glasses so the speaker can deliver it naturally.

## Getting started

1. Copy `.env.example` to `.env` and fill in the required API keys (Supabase, Deepgram, ElevenLabs, OpenAI; see comments in `.env.example`).
2. Run Supabase migrations and optionally seed data (see `supabase/`).
3. Start each piece:

   - **Backend:** `./scripts/start_backend.sh` (or `uvicorn` from `packages/backend`)
   - **Glasses rig:** `./scripts/start_rig.sh` (from a machine with webcam + mic, e.g. Mac with AirPods)
   - **Web dashboard:** `cd packages/web && npm install && npm run dev`

Supabase is used in the cloud (not run via Docker here). The backend can be run in Docker with `docker-compose up`; see `docker-compose.yml`.

Required API keys and optional env vars are documented in `.env.example`.
