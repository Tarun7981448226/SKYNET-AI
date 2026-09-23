"""Gmail API adapter (read-only scope only — never write/modify/send) that
parses LinkedIn job-alert emails filed under a label into individual jobs.
LinkedIn itself is never scraped or logged into; this only reads emails
Tarun already receives. See source-adapters and secrets-hygiene skills.

Because the scope is read-only we can't mark messages processed on Gmail's
side, so every run re-queries the lookback window; RawPost's unique
(source_id, external_id) constraint makes re-inserting the same job a
no-op, so this stays idempotent without ever writing back to Gmail.

Best-effort HTML parsing: LinkedIn digest emails list several jobs per
email, each linking to a "/jobs/view/" URL. This heuristic may need
adjusting once we see real email samples."""

import base64
import logging
from pathlib import Path

from bs4 import BeautifulSoup

from app.config import settings
from app.sources.base import RawJobPosting, SourceAdapter

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _get_credentials():
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    token_path = Path(settings.gmail_token_path)
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        refreshed = False
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                refreshed = True
            except RefreshError:
                # The refresh token itself is dead (revoked, or — the
                # common case for an unverified/"Testing" OAuth consent
                # screen — auto-expired after 7 days), not just the short-
                # lived access token. This used to propagate uncaught and
                # crash every run until someone noticed; falls through to
                # the interactive flow below instead, same as having no
                # token at all. That flow needs a real browser, so it only
                # actually recovers when run locally — a GitHub Actions
                # run will still fail and alert, but at least with a clear
                # cause instead of an unhandled exception.
                logger.warning("gmail token refresh failed (refresh token expired/revoked) — re-authorizing")
        if not refreshed:
            flow = InstalledAppFlow.from_client_secrets_file(settings.gmail_credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json())
    return creds


def _get_service():
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=_get_credentials())


def _decode_part(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")


def _extract_html(payload: dict) -> str | None:
    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
        return _decode_part(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        html = _extract_html(part)
        if html:
            return html
    return None


def _extract_plain(payload: dict) -> str | None:
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return _decode_part(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        text = _extract_plain(part)
        if text:
            return text
    return None


def _jobs_from_html(message_id: str, html: str) -> list[RawJobPosting]:
    soup = BeautifulSoup(html, "lxml")
    postings: list[RawJobPosting] = []
    seen_urls: set[str] = set()
    for idx, anchor in enumerate(soup.find_all("a", href=True)):
        href = anchor["href"]
        if "/jobs/view/" not in href or href in seen_urls:
            continue
        seen_urls.add(href)
        block = anchor.find_parent(["td", "div", "tr"]) or anchor
        text = block.get_text(separator="\n", strip=True) or anchor.get_text(strip=True)
        if not text:
            continue
        postings.append(
            RawJobPosting(
                source_name="gmail_linkedin",
                external_id=f"{message_id}:{idx}",
                raw_text=text,
                url=href,
            )
        )
    return postings


class GmailLinkedInAlertsAdapter(SourceAdapter):
    def fetch(self) -> list[RawJobPosting]:
        service = _get_service()
        query = f'label:"{settings.gmail_linkedin_label}" newer_than:{settings.gmail_lookback_days}d'
        postings: list[RawJobPosting] = []

        response = service.users().messages().list(userId="me", q=query).execute()
        for msg_ref in response.get("messages", []):
            message_id = msg_ref["id"]
            message = service.users().messages().get(userId="me", id=message_id, format="full").execute()
            payload = message.get("payload", {})

            html = _extract_html(payload)
            if html:
                jobs = _jobs_from_html(message_id, html)
                if jobs:
                    postings.extend(jobs)
                    continue

            plain = _extract_plain(payload)
            if plain:
                postings.append(
                    RawJobPosting(
                        source_name="gmail_linkedin",
                        external_id=message_id,
                        raw_text=plain,
                        url=None,
                    )
                )
        return postings

    def dedupe_key(self, posting: RawJobPosting) -> str:
        return f"{posting.source_name}:{posting.external_id}"
