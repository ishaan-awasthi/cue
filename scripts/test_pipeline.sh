#!/usr/bin/env bash
# End-to-end test without hardware. Opens a WebSocket to the backend, sends pre-recorded audio bytes
# and video frames from test fixture files in a /tests/fixtures directory, and verifies that at least
# one nudge OR one QA whisper is received within 60 seconds. Also sends a sample question audio clip
# to test the QA pipeline end-to-end. Exits 0 on success, 1 on failure.
