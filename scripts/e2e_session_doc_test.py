import json
import os
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4

BASE = sys.argv[1] if len(sys.argv) > 1 else os.getenv("CUE_API_BASE", "http://localhost:8000")
USER_ID = "00000000-0000-0000-0000-000000000001"


def api(method: str, path: str, body: bytes | None = None, content_type: str | None = None):
    headers = {"X-User-Id": USER_ID}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(f"{BASE}{path}", method=method, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        if not data:
            return None
        return json.loads(data.decode("utf-8"))


def upload_text_file(session_id: str, filename: str, text: str):
    boundary = f"----CueBoundary{uuid4().hex}"
    payload = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: text/plain\r\n\r\n"
        f"{text}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    return api(
        "POST",
        f"/sessions/{session_id}/files",
        body=payload,
        content_type=f"multipart/form-data; boundary={boundary}",
    )


def main():
    print("Creating session...")
    session = api("POST", "/sessions")
    session_id = session["id"]
    print("session_id:", session_id)

    doc_text = (
        "Cue startup plan: We acquire first customers via founder-led outreach and campus pilot programs. "
        "After pilot wins, we expand through ambassador loops and partner referrals."
    )
    print("Uploading test doc...")
    uploaded = upload_text_file(session_id, "test-strategy.txt", doc_text)
    print("uploaded:", uploaded["id"], uploaded.get("processing_status"))

    print("Polling processing status...")
    status = "uploaded"
    for _ in range(20):
        files = api("GET", f"/sessions/{session_id}/files") or []
        if files:
            status = files[0].get("processing_status", "unknown")
            print("status:", status, "chunks:", files[0].get("chunk_count"))
            if status in ("ready", "failed"):
                break
        time.sleep(1.5)

    if status != "ready":
        print("Not ready; cannot verify grounded retrieval.")
        return

    print("Asking grounded question...")
    grounded = api(
        "POST",
        f"/sessions/{session_id}/qa",
        body=json.dumps({"question": "How do we get the first 100 customers?"}).encode("utf-8"),
        content_type="application/json",
    )
    print("grounded:", json.dumps(grounded, indent=2))

    print("Asking likely-unrelated question...")
    fallback = api(
        "POST",
        f"/sessions/{session_id}/qa",
        body=json.dumps({"question": "What is the capital of France?"}).encode("utf-8"),
        content_type="application/json",
    )
    print("fallback:", json.dumps(fallback, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print("HTTPError:", e.code, body)
        raise
