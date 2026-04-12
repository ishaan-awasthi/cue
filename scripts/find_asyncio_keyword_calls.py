from pathlib import Path
import re


pattern = re.compile(r"asyncio_to_thread\([^)]*=")

for p in Path("packages/backend").rglob("*.py"):
    text = p.read_text(encoding="utf-8")
    if pattern.search(text):
        print(p)

for p in Path("cue/packages/backend").rglob("*.py"):
    text = p.read_text(encoding="utf-8")
    if pattern.search(text):
        print(p)
