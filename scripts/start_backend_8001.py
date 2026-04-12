import os
import subprocess

ROOT = r"C:\Users\Angad\cue"
LOG = os.path.join(ROOT, "backend-dev-8001.log")
flags = 0x00000008 | 0x00000200

with open(LOG, "w", encoding="utf-8") as blog:
    proc = subprocess.Popen(
        ["python", "-m", "uvicorn", "packages.backend.main:app", "--host", "0.0.0.0", "--port", "8001"],
        cwd=ROOT,
        stdout=blog,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )

print(proc.pid)
