from pathlib import Path

root = Path(r"C:\Users\Angad\cue\packages\web")
patterns = ["New session", "Start session", "No sessions yet", "Backend unreachable", "/sessions/"]

for path in root.rglob("*.tsx"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    hits = [p for p in patterns if p in text]
    if hits:
        print(path)
        for p in hits:
            print("  ", p)
