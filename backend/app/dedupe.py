import hashlib
import re


def compute_hash(*parts: str) -> str:
    """sha256 of normalized (lowercased, whitespace-collapsed) parts, joined.
    Used for RawPost.content_hash and Job.content_hash so dedupe is stable
    against minor formatting differences across sources."""
    normalized = "|".join(re.sub(r"\s+", " ", (p or "").strip().lower()) for p in parts)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
