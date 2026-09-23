"""Fetches a single arbitrary job-posting URL pasted by Tarun (dashboard's
"paste a link" feature) and reduces it to plain text for the same JD parser
every other source already uses (app/parsing/parser.py).

Not a SourceAdapter (backend/app/sources/base.py) like the other sources —
this fetches exactly one URL on demand rather than polling a fixed list, so
it doesn't fit that fetch()-returns-many-postings interface. Deliberately
simple (regex-based tag stripping, same technique as
greenhouse_lever.py's _strip_html) rather than a full readability/DOM
library: good enough for server-rendered career pages, which is most of
them. A JavaScript-only single-page-app career site won't have any job text
in the raw HTML requests.get() sees — that's a known, accepted limitation,
not a bug to chase; the caller surfaces it as "couldn't read that page"."""

import re

import requests

_REQUEST_TIMEOUT_S = 15
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; SKYNETBot/1.0; personal job-tracking assistant; +https://github.com/)"
    )
}

# Strip whole <script>/<style> elements (not just the tags) first — their
# inner content is never visible page text and would otherwise pollute what
# gets handed to the JD parser with raw JS/CSS.
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"[ \t]+")
_BLANK_LINES_RE = re.compile(r"\n\s*\n+")


class LinkFetchError(Exception):
    """Raised for anything that stops a pasted URL from becoming usable job
    text — network failure, non-200 response, or a page with no readable
    text (most likely a JS-only SPA)."""


def fetch_job_page_text(url: str) -> str:
    try:
        resp = requests.get(url, timeout=_REQUEST_TIMEOUT_S, headers=_HEADERS)
    except requests.RequestException as exc:
        raise LinkFetchError(f"couldn't reach that URL: {exc}") from exc

    if resp.status_code != 200:
        raise LinkFetchError(f"page returned HTTP {resp.status_code}")

    text = _SCRIPT_STYLE_RE.sub(" ", resp.text)
    text = _TAG_RE.sub(" ", text)
    # Collapse runs of spaces/tabs but keep single newlines — they're the
    # closest thing to paragraph structure a stripped-tags text has left,
    # and the JD parser's prompt reads more reliably with some structure
    # than one giant run-on line.
    text = _WHITESPACE_RE.sub(" ", text)
    text = _BLANK_LINES_RE.sub("\n\n", text)
    text = text.strip()

    if len(text) < 100:
        raise LinkFetchError(
            "that page has no readable text — it may render entirely via JavaScript, which this fetcher can't execute"
        )
    return text
