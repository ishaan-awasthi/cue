import os
import signal
import sys

import psutil


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/kill_port.py <port>")
        return 1
    port = int(sys.argv[1])
    killed = []
    for conn in psutil.net_connections(kind="inet"):
        if conn.laddr and conn.laddr.port == port and conn.status == psutil.CONN_LISTEN and conn.pid:
            pid = conn.pid
            if pid not in killed:
                try:
                    os.kill(pid, signal.SIGTERM)
                except Exception:
                    pass
                killed.append(pid)
    print("killed:", killed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
