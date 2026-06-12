from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    commands = [
        ["uv", "run", "ruff", "check", "."],
        ["uv", "run", "ruff", "format", "--check", "."],
        ["uv", "run", "mypy", "backend"],
        ["uv", "run", "pytest"],
        [npm, "--prefix", "frontend", "run", "lint"],
        [npm, "--prefix", "frontend", "run", "typecheck"],
        [npm, "--prefix", "frontend", "run", "test", "--", "--run"],
        [npm, "--prefix", "frontend", "run", "build"],
    ]

    for command in commands:
        if shutil.which(command[0]) is None:
            print(f"Missing required command: {command[0]}", file=sys.stderr)
            return 127
        print(f"\n$ {' '.join(command)}")
        completed = subprocess.run(command, cwd=ROOT, check=False)
        if completed.returncode != 0:
            return completed.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
