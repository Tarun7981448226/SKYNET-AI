"""Thin entrypoint so `python -m backend.cli ...` works from the repo root.
Mirrors the sys.path shim in tests/conftest.py: everything under
backend/app/ imports as `app.xxx`, so we put backend/ on sys.path before
delegating to the real implementation in app/cli.py."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
