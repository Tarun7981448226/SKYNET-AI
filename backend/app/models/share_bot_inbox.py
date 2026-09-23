from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ShareBotInboxItem(Base):
    """One row per Telegram message the share_bot Cloudflare Worker webhook
    received (Mark IV serverless: the Worker just stores raw messages — it
    can't run Tesseract OCR — a scheduled GitHub Action drains this table,
    does the OCR/parsing, and converts each row into a normal RawPost."""

    __tablename__ = "share_bot_inbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    processed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
