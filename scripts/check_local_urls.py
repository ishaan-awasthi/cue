import urllib.request

for url in ("http://localhost:8000/docs", "http://localhost:3000"):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            print(url, r.status)
    except Exception as e:
        print(url, "ERR", e)
