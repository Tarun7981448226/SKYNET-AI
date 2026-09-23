"""TEMPORARY stand-in for backend/app/whatsapp.py's real Meta WhatsApp
Cloud API delivery (2026-09-23): Meta flagged Tarun's account with a
device-trust security hold mid-signup, blocking the WhatsApp Cloud API app
creation he needs to do himself. Sends the tailored resume PDF to his
already-configured Telegram bot (same TELEGRAM_BOT_TOKEN/
TELEGRAM_OWNER_CHAT_ID as alerts.py) instead, so the "paste a link" feature
still delivers a resume to his phone tonight rather than sitting blocked on
Meta's side.

Revert once the hold clears: in backend/app/cli.py, swap
`from app.telegram_delivery import TelegramDeliveryError, send_resume_document`
back to `from app.whatsapp import WhatsAppError, send_resume_pdf`, restore
the two names used in run_link_resume, and add the three WHATSAPP_* secrets
per README's "WhatsApp delivery setup" section (link_resume.yml already
carries those env lines, untouched, ready to go)."""

import asyncio
import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class TelegramDeliveryError(Exception):
    pass


def send_resume_document(pdf_path: str, caption: str) -> None:
    """Same signature/behavior contract as whatsapp.send_resume_pdf: raises
    TelegramDeliveryError on any failure, which run_link_resume treats as
    non-fatal (the resume is still real and reachable via its Drive link
    even if this delivery step fails)."""
    if not settings.telegram_bot_token:
        raise TelegramDeliveryError("TELEGRAM_BOT_TOKEN is not set")
    chat_id = settings.telegram_owner_chat_id or settings.telegram_alert_chat_id
    if not chat_id:
        raise TelegramDeliveryError("Neither TELEGRAM_OWNER_CHAT_ID nor TELEGRAM_ALERT_CHAT_ID is set")

    path = Path(pdf_path)
    if not path.exists():
        raise TelegramDeliveryError(f"no such file: {pdf_path}")

    try:
        from telegram import Bot
        from telegram.error import TelegramError

        async def _do_send() -> None:
            bot = Bot(token=settings.telegram_bot_token)
            async with bot:
                await bot.send_document(chat_id=chat_id, document=path, filename=path.name, caption=caption)

        asyncio.run(_do_send())
    except TelegramError as exc:
        raise TelegramDeliveryError(str(exc)) from exc
