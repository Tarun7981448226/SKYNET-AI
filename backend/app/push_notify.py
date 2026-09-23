"""Web Push trigger (Mark VI): fires when a new tailored resume is ready,
so Tarun gets notified without the dashboard open. The actual send (VAPID
signing, subscription lookup) lives on the Next.js side
(frontend/lib/push/send.ts) — this just POSTs to that route over HTTP,
authenticated with a shared secret header since GitHub Actions has no
session cookie. Uses `requests`, already the project's outbound-HTTP
dependency of choice (see whatsapp.py, greenhouse_lever.py)."""

import logging

import requests

from app.config import settings

logger = logging.getLogger(__name__)


def notify_resume_ready(company: str, role: str, score: int | None, drive_link: str | None) -> None:
    """Never raises — a notification failure must not crash or roll back
    the tailoring transaction that already succeeded, same contract as
    alerts.py's _send(). No-ops silently if push isn't configured, so local
    dev/tests need no env changes."""
    if not settings.push_notify_url or not settings.push_notify_secret:
        return
    try:
        score_text = f", fit score {score}" if score is not None else ""
        requests.post(
            settings.push_notify_url,
            json={
                "title": "New tailored resume ready",
                "body": f"{role} at {company}{score_text}",
                "url": drive_link or "/dashboard",
            },
            headers={"x-push-secret": settings.push_notify_secret},
            timeout=10,
        )
    except Exception as exc:
        logger.error("push notification failed: %s", exc)
