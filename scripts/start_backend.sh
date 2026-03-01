#!/usr/bin/env bash
# Loads .env from repo root, navigates to packages/backend, starts uvicorn on 0.0.0.0:8000 with --reload.
# Prints WebSocket URL for the glasses rig. Notes that the fluency model must be downloaded before
# starting (see models/README.md).
