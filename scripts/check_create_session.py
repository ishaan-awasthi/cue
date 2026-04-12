import json
import urllib.request

req = urllib.request.Request(
    "http://localhost:8000/sessions",
    method="POST",
    headers={"X-User-Id": "00000000-0000-0000-0000-000000000001"},
)
with urllib.request.urlopen(req, timeout=10) as r:
    data = json.loads(r.read().decode("utf-8"))
print(data)
