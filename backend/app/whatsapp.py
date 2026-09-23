"""Sends the tailored resume PDF straight to Tarun's WhatsApp via Meta's
official WhatsApp Cloud API — the only compliant way to send WhatsApp
messages programmatically. An unofficial personal-account automation
library (whatsapp-web.js/Baileys-style) risks the account getting banned
for automation, exactly the kind of thing this project already avoids for
LinkedIn/Instagram — so this uses Meta's real Business API instead, same
"compliant path only" stance.

One-time setup Tarun does himself (I can't sign up for this on his behalf):
create a free Meta developer app, add the WhatsApp product, and note the
test phone number's WHATSAPP_PHONE_NUMBER_ID, a WHATSAPP_ACCESS_TOKEN, and
add his own number as a verified recipient. See README's "WhatsApp
delivery setup" section for the exact steps.

Real constraint from WhatsApp's own rules, not something this code can
route around: a business-initiated message (SKYNET sending unprompted)
only delivers as free text/document within 24 hours of the recipient's
last message *to* the business number — outside that window, only a
pre-approved message template can reach them. In practice: message the
test number "hi" whenever it's been a while, to keep the window open."""

import logging
from pathlib import Path

import requests

from app.config import settings

logger = logging.getLogger(__name__)

_GRAPH_API_VERSION = "v21.0"
_REQUEST_TIMEOUT_S = 30


class WhatsAppError(Exception):
    pass


def _api_url(path: str) -> str:
    return f"https://graph.facebook.com/{_GRAPH_API_VERSION}/{path}"


def _require_config() -> tuple[str, str, str]:
    if not settings.whatsapp_access_token:
        raise WhatsAppError("WHATSAPP_ACCESS_TOKEN is not set")
    if not settings.whatsapp_phone_number_id:
        raise WhatsAppError("WHATSAPP_PHONE_NUMBER_ID is not set")
    if not settings.whatsapp_recipient_number:
        raise WhatsAppError("WHATSAPP_RECIPIENT_NUMBER is not set")
    return settings.whatsapp_access_token, settings.whatsapp_phone_number_id, settings.whatsapp_recipient_number


def _upload_media(token: str, phone_number_id: str, pdf_bytes: bytes, filename: str) -> str:
    resp = requests.post(
        _api_url(f"{phone_number_id}/media"),
        headers={"Authorization": f"Bearer {token}"},
        data={"messaging_product": "whatsapp", "type": "application/pdf"},
        files={"file": (filename, pdf_bytes, "application/pdf")},
        timeout=_REQUEST_TIMEOUT_S,
    )
    if not resp.ok:
        raise WhatsAppError(f"media upload failed: HTTP {resp.status_code} {resp.text[:300]}")
    media_id = resp.json().get("id")
    if not media_id:
        raise WhatsAppError(f"media upload returned no id: {resp.text[:300]}")
    return media_id


def send_resume_pdf(pdf_path: str, caption: str) -> None:
    """Uploads pdf_path as WhatsApp media, then sends it as a document
    message to WHATSAPP_RECIPIENT_NUMBER. Raises WhatsAppError on any
    failure — the caller (backend/app/cli.py's run_link_resume) treats
    that as non-fatal to the overall request: the resume is still real and
    reachable via its Drive link even if WhatsApp delivery itself failed."""
    token, phone_number_id, _recipient = _require_config()
    path = Path(pdf_path)
    pdf_bytes = path.read_bytes()
    media_id = _upload_media(token, phone_number_id, pdf_bytes, path.name)

    resp = requests.post(
        _api_url(f"{phone_number_id}/messages"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "messaging_product": "whatsapp",
            "to": settings.whatsapp_recipient_number,
            "type": "document",
            "document": {"id": media_id, "filename": path.name, "caption": caption},
        },
        timeout=_REQUEST_TIMEOUT_S,
    )
    if not resp.ok:
        raise WhatsAppError(f"send failed: HTTP {resp.status_code} {resp.text[:300]}")
