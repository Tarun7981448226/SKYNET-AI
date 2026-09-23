"""Greenhouse and Lever public job-board API adapters.

Both adapters poll the same seed slug list rather than assigning each
company to one ATS vendor by guesswork: a slug that isn't actually on that
board just 404s and is skipped. Read-only public JSON APIs, no auth."""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import datetime

import requests

from app.config import settings
from app.sources.base import RawJobPosting, SourceAdapter

logger = logging.getLogger(__name__)

_REQUEST_WALL_CLOCK_LIMIT_S = 10
# Shared across both adapters/calls for the life of the process — cheaper
# than spinning up a new pool per request, and sized well above the ~10
# default slugs so every request for one adapter's fetch() truly runs
# concurrently instead of queueing behind each other.
_REQUEST_EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix="greenhouse_lever_request")


def _fetch_all(source_label: str, slug_to_url: dict[str, str], timeout: int) -> dict[str, requests.Response]:
    """Fetches every slug's URL concurrently and returns {slug: response}
    for the ones that came back 200, logging+skipping the rest.

    Two things this guards against, learned the hard way from Greenhouse:
    - A slow-but-steady trickle response can hang past `timeout=` (that
      only bounds gaps *between* bytes, not a call's total duration) — each
      future gets a hard `_REQUEST_WALL_CLOCK_LIMIT_S` wait via
      concurrent.futures rather than requests' own timeout. (A signal.alarm
      -based version of this was tried first but proved unreliable: SIGALRM
      delivery to a thread blocked deep in a C-level socket/TLS read can be
      delayed or swallowed depending on exactly where the blocking call is.
      A plain condition-variable wait via .result(timeout=...) isn't
      subject to that.)
    - Fetching sequentially, one slug after another, made the *normal*
      no-hang case slow too: ~10 real round trips at 15-20s each adds up to
      close to the step's whole 3-minute budget on its own. Submitting all
      of them up front and collecting results after means the wall-clock
      cost is roughly the slowest single request, not the sum of all of
      them."""
    futures = {slug: _REQUEST_EXECUTOR.submit(requests.get, url, timeout=timeout) for slug, url in slug_to_url.items()}
    responses: dict[str, requests.Response] = {}
    for slug, future in futures.items():
        try:
            resp = future.result(timeout=_REQUEST_WALL_CLOCK_LIMIT_S)
        except FutureTimeoutError:
            logger.warning(
                "%s:%s request failed: exceeded %ss wall-clock limit", source_label, slug, _REQUEST_WALL_CLOCK_LIMIT_S
            )
            continue
        except requests.RequestException as exc:
            logger.warning("%s:%s request failed: %s", source_label, slug, exc)
            continue
        if resp.status_code == 404:
            logger.info("%s:%s not found, skipping", source_label, slug)
            continue
        if resp.status_code != 200:
            logger.warning("%s:%s returned %s, skipping", source_label, slug, resp.status_code)
            continue
        responses[slug] = resp
    return responses


def _parse_iso_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _parse_epoch_ms_date(value):
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000).date()
    except (ValueError, OverflowError, OSError):
        return None

DEFAULT_SLUGS = [
    "openai",
    "anthropic",
    "stripe",
    "databricks",
    "airbnb",
    "figma",
    "scaleai",
    "cloudflare",
    "datadog",
    "robinhood",
]


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").strip()


def _greenhouse_slugs() -> list[str]:
    raw = settings.greenhouse_board_tokens
    return [s.strip() for s in raw.split(",") if s.strip()] if raw else DEFAULT_SLUGS


def _lever_slugs() -> list[str]:
    raw = settings.lever_company_slugs
    return [s.strip() for s in raw.split(",") if s.strip()] if raw else DEFAULT_SLUGS


class GreenhouseAdapter(SourceAdapter):
    def fetch(self) -> list[RawJobPosting]:
        slug_to_url = {
            slug: f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
            for slug in _greenhouse_slugs()
        }
        postings: list[RawJobPosting] = []
        for slug, resp in _fetch_all("greenhouse", slug_to_url, timeout=15).items():
            for job in resp.json().get("jobs", []):
                location = (job.get("location") or {}).get("name", "")
                text = f"{job.get('title', '')}\n{location}\n{_strip_html(job.get('content', ''))}"
                postings.append(
                    RawJobPosting(
                        source_name=f"greenhouse:{slug}",
                        external_id=str(job["id"]),
                        raw_text=text,
                        url=job.get("absolute_url"),
                        posted_date=_parse_iso_date(job.get("updated_at")),
                        deadline=_parse_iso_date(job.get("application_deadline")),
                    )
                )
        return postings

    def dedupe_key(self, posting: RawJobPosting) -> str:
        return f"{posting.source_name}:{posting.external_id}"


class LeverAdapter(SourceAdapter):
    def fetch(self) -> list[RawJobPosting]:
        slug_to_url = {slug: f"https://api.lever.co/v0/postings/{slug}?mode=json" for slug in _lever_slugs()}
        postings: list[RawJobPosting] = []
        for slug, resp in _fetch_all("lever", slug_to_url, timeout=15).items():
            for posting in resp.json():
                categories = posting.get("categories", {})
                location = categories.get("location", "")
                text = (
                    f"{posting.get('text', '')}\n{location}\n"
                    f"{_strip_html(posting.get('descriptionPlain') or posting.get('description', ''))}"
                )
                postings.append(
                    RawJobPosting(
                        source_name=f"lever:{slug}",
                        external_id=str(posting["id"]),
                        raw_text=text,
                        url=posting.get("hostedUrl"),
                        posted_date=_parse_epoch_ms_date(posting.get("createdAt")),
                    )
                )
        return postings

    def dedupe_key(self, posting: RawJobPosting) -> str:
        return f"{posting.source_name}:{posting.external_id}"
