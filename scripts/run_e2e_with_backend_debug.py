import subprocess
import time
import urllib.request

ROOT = r"C:\Users\Angad\cue"
BASE = "http://localhost:8001"


def wait_up(url: str, timeout_s: float = 20.0) -> bool:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def main() -> int:
    proc = subprocess.Popen(
        ["python", "-m", "uvicorn", "packages.backend.main:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "debug"],
        cwd=ROOT,
        text=True,
    )
    try:
        if not wait_up(f"{BASE}/docs"):
            print("backend on 8001 did not start")
            return 1
        test = subprocess.run(
            ["python", "scripts/e2e_session_doc_test.py", BASE],
            cwd=ROOT,
            text=True,
        )
        return test.returncode
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
