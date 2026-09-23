"""Telegram alerts for the 24/7 daemon (Mark IV): a failed pipeline stage or
a completed nightly run gets pushed to Tarun's phone instead of sitting
silently in a log file. Uses the same TELEGRAM_BOT_TOKEN as share_bot; sends
to TELEGRAM_ALERT_CHAT_ID if set, else falls back to TELEGRAM_OWNER_CHAT_ID
(both are just Tarun's own chat id in practice)."""

import asyncio
import logging
from datetime import datetime, timezone

from app.config import settings

logger = logging.getLogger(__name__)


class AlertError(Exception):
    pass


def _alert_chat_id() -> str:
    chat_id = settings.telegram_alert_chat_id or settings.telegram_owner_chat_id
    if not chat_id:
        raise AlertError("Neither TELEGRAM_ALERT_CHAT_ID nor TELEGRAM_OWNER_CHAT_ID is set")
    return chat_id


def _send(text: str) -> None:
    """Never raises — alerting must not crash the pipeline stage that's
    trying to report a failure. Any problem (missing token, chat id, network)
    is logged locally instead."""
    try:
        if not settings.telegram_bot_token:
            raise AlertError("TELEGRAM_BOT_TOKEN is not set")

        from telegram import Bot

        async def _do_send() -> None:
            bot = Bot(token=settings.telegram_bot_token)
            async with bot:
                await bot.send_message(chat_id=_alert_chat_id(), text=text)

        asyncio.run(_do_send())
    except Exception as exc:
        logger.error("failed to send Telegram alert: %s", exc)


def send_error_alert(error_msg: str, error_type: str = "error") -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    _send(f"\U0001f6a8 [{error_type.upper()}] at {timestamp}: {error_msg}")


def send_source_failure_alert(source: str) -> None:
    send_error_alert(f"Failed to fetch from {source}", error_type="telegram" if "telegram" in source else source)


def send_gmail_failure_alert(detail: str = "") -> None:
    # "invalid_grant" specifically means the OAuth refresh token itself
    # expired or was revoked (common for an unverified/"Testing" Google
    # Cloud OAuth consent screen — those refresh tokens auto-expire after
    # 7 days) — every hourly run fails silently-ish (a generic alert, no
    # fix instruction) until someone notices LinkedIn jobs stopped coming
    # in and re-authorizes locally. Naming the real cause here so the next
    # occurrence is actionable instead of another "failed to fetch."
    if "invalid_grant" in detail:
        _send(
            "⚠️ [GMAIL] LinkedIn alerts stopped: the Gmail token expired/was revoked. "
            "Re-run the local auth flow (see gmail_linkedin_alerts.py's _get_credentials) "
            "and update the GMAIL_TOKEN_JSON GitHub secret."
        )
    else:
        _send("⚠️ [GMAIL] Failed to fetch LinkedIn job alerts")


def send_sheets_failure_alert(company: str, role: str) -> None:
    _send(f"⚠️ [SHEETS] Failed to log job {company} {role}")


def send_success_alert(msg: str) -> None:
    _send(f"✅ {msg}")
