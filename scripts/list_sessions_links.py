from pathlib import Path

path = Path(r"C:\Users\Angad\cue\packages\web\app\app\sessions\[id]\page.tsx")
for i, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
    if "/sessions/" in line:
        print(i, line.strip())
