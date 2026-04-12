from pathlib import Path


for p in Path(".").rglob("main.py"):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    if "async def asyncio_to_thread" in text and "packages\\backend" in str(p).replace("/", "\\"):
        print(p)
