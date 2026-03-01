#!/usr/bin/env bash
# Loads .env from repo root, navigates to packages/glasses, checks webcam is accessible at device index 0
# and microphone input is available, then runs ws_client.py. Prints clear error and exits if either device
# is missing. Prints the backend WebSocket URL it will connect to.
