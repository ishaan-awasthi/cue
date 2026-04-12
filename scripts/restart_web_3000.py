import os
import re
import subprocess
import time
import urllib.request

ROOT = r"C:\Users\Angad\cue"
WEB_DIR = r"C:\Users\Angad\cue\packages\web"

out = subprocess.check_output(["netstat", "-ano"], text=True, errors="ignore")
pids = []
for line in out.splitlines():
    if ":3000" in line and "LISTENING" in line:
        m = re.search(r"\s(\d+)\s*$", line)
        if m:
            pids.append(m.group(1))

for pid in sorted(set(pids)):
    subprocess.run(["taskkill", "/PID", pid, "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

env = os.environ.copy()
env["NEXT_PUBLIC_API_URL"] = "http://localhost:8000"
DETACHED = 0x00000008 | 0x00000200
with open(os.path.join(ROOT, "web-dev.log"), "w", encoding="utf-8") as log:
    subprocess.Popen(
        ["cmd", "/c", "npm run dev -- -p 3000 -H 0.0.0.0"],
        cwd=WEB_DIR,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=DETACHED,
    )

time.sleep(8)
try:
    with urllib.request.urlopen("http://localhost:3000", timeout=5) as r:
        print("web", r.status)
except Exception as e:
    print("web ERR", e)
