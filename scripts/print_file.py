from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/print_file.py <path>")
        return 1
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"missing: {path}")
        return 1
    print(path.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
