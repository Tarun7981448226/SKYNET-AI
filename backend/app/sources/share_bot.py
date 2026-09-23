"""Share-intake: Tarun forwards a link, caption text, or screenshot to the
SKYNET Telegram bot. Mark IV (serverless): messages arrive via a Cloudflare
Worker webhook (see cloudflare/share_bot_webhook/) that only has permission
to insert into share_bot_inbox — it can't run Tesseract, so this adapter
(poll-based like the other sources, called from the hourly pipeline) drains
that table, does the OCR/parsing, and converts each row into a normal
RawJobPosting. TELEGRAM_OWNER_CHAT_ID is checked again here as
defense-in-depth even though the Worker already enforces it."""

import asyncio
import logging
from io import BytesIO

import pytesseract
from PIL import Image

from app.config import settings
from app.db import SessionLocal
from app.models import ShareBotInboxItem
from app.sources.base import RawJobPosting, SourceAdapter

logger = logging.getLogger(__name__)

SOURCE_NAME = "share_bot"


async def _ocr_photo(file_id: str) -> str:
    from telegram import Bot

    bot = Bot(token=settings.telegram_bot_token)
    async with bot:
        file = await bot.get_file(file_id)
        buf = BytesIO()
        await file.download_to_memory(out=buf)
    buf.seek(0)
    return pytesseract.image_to_string(Image.open(buf))


class ShareBotAdapter(SourceAdapter):
    def fetch(self) -> list[RawJobPosting]:
        owner_id = int(settings.telegram_owner_chat_id) if settings.telegram_owner_chat_id else None
        postings: list[RawJobPosting] = []
        with SessionLocal() as session:
            items = session.query(ShareBotInboxItem).filter_by(processed=False).all()
            for item in items:
                if owner_id is not None and item.chat_id != owner_id:
                    logger.info(
                        "skipping share_bot_inbox item %s from unauthorized chat %s", item.id, item.chat_id
                    )
                    item.processed = True
                    session.commit()
                    continue

                text = item.text or ""
                if item.photo_file_id:
                    try:
                        ocr_text = asyncio.run(_ocr_photo(item.photo_file_id))
                    except Exception as exc:
                        logger.warning("OCR failed for share_bot_inbox item %s: %s", item.id, exc)
                        ocr_text = ""
                    text = f"{text}\n{ocr_text}".strip() if text else ocr_text

                if text.strip():
                    postings.append(
                        RawJobPosting(
                            source_name=SOURCE_NAME,
                            external_id=f"msg:{item.telegram_message_id}",
                            raw_text=text,
                            url=text if text.startswith("http") else None,
                        )
                    )
                item.processed = True
                session.commit()
        return postings

    def dedupe_key(self, posting: RawJobPosting) -> str:
        return f"{SOURCE_NAME}:{posting.external_id}"
