from pathlib import Path

p = Path(r"C:\Users\Angad\cue\backend-dev.log")
lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
for line in lines[-160:]:
    print(line)
