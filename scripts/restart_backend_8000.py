import os
import re
import signal
import subprocess
import time


ROOT = r"C:\Users\Angad\cue"
LOG = os.path.join(ROOT, "backend-dev.log")


def pids_on_8000() -> list[int]:
    out = subprocess.check_output("netstat -ano", shell=True, text=True, errors="ignore")
    pids: set[int] = set()
    for line in out.splitlines():
        if ":8000" not in line or "LISTENING" not in line:
            continue
        m = re.search(r"\s(\d+)\s*$", line.strip())
        if m:
            pids.add(int(m.group(1)))
    return sorted(pids)


def kill_pid(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=False)


def main() -> int:
    for pid in pids_on_8000():
        kill_pid(pid)
    time.sleep(1)

    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    with open(LOG, "w", encoding="utf-8") as blog:
        proc = subprocess.Popen(
            ["python", "-m", "uvicorn", "packages.backend.main:app", "--host", "0.0.0.0", "--port", "8000"],
            cwd=ROOT,
            stdout=blog,
            stderr=subprocess.STDOUT,
            creationflags=flags,
        )
    print(f"started backend pid={proc.pid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
