import hashlib
import json
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "output" / "llm_cache"


def _cache_path(prompt: str) -> Path:
    key = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{key}.json"


def get_cached(prompt: str) -> str | None:
    path = _cache_path(prompt)
    if not path.exists():
        return None
    return json.loads(path.read_text())["response"]


def set_cached(prompt: str, response: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(prompt).write_text(json.dumps({"response": response}))
