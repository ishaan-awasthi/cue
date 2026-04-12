import os
import subprocess
import time
import urllib.request

ROOT = r"C:\Users\Angad\cue"
WEB_DIR = r"C:\Users\Angad\cue\packages\web"

DETACHED = 0x00000008
NEW_GROUP = 0x00000200
flags = DETACHED | NEW_GROUP

with open(os.path.join(ROOT, "backend-dev.log"), "w", encoding="utf-8") as blog:
    subprocess.Popen(
        ["python", "-m", "uvicorn", "packages.backend.main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=ROOT,
        stdout=blog,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )

env = os.environ.copy()
env["NEXT_PUBLIC_API_URL"] = "http://localhost:8000"
with open(os.path.join(ROOT, "web-dev.log"), "w", encoding="utf-8") as wlog:
    subprocess.Popen(
        ["cmd", "/c", "npm run dev -- -p 3000 -H 0.0.0.0"],
        cwd=WEB_DIR,
        env=env,
        stdout=wlog,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )

time.sleep(6)

def check(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return str(r.status)
    except Exception as e:
        return f"ERR: {e}"

print("backend", check("http://localhost:8000/docs"))
print("web", check("http://localhost:3000"))
