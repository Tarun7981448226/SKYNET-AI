"""Telethon adapter for configured public Telegram job channels.

Read-only listener (no messages sent to any channel/group) — see the
source-adapters skill. First run requires an interactive login (phone
number + code) which must happen in a real terminal since this process
can't prompt for input non-interactively; afterward the session file lets
it run unattended."""

import asyncio
import logging

from app.config import settings
from app.sources.base import RawJobPosting, SourceAdapter

logger = logging.getLogger(__name__)


def _job_channels() -> list[str]:
    raw = settings.telegram_job_channels
    return [c.strip() for c in raw.split(",") if c.strip()] if raw else []


class TelegramChannelsAdapter(SourceAdapter):
    def __init__(self, limit_per_channel: int = 50):
        self.limit_per_channel = limit_per_channel

    def fetch(self) -> list[RawJobPosting]:
        return asyncio.run(self._fetch_async())

    async def _fetch_async(self) -> list[RawJobPosting]:
        from telethon import TelegramClient

        channels = _job_channels()
        if not channels:
            logger.warning("TELEGRAM_JOB_CHANNELS is empty, nothing to fetch")
            return []

        postings: list[RawJobPosting] = []
        client = TelegramClient(
            settings.telegram_session_name,
            int(settings.telegram_api_id),
            settings.telegram_api_hash,
        )
        async with client:
            for channel in channels:
                try:
                    async for message in client.iter_messages(channel, limit=self.limit_per_channel):
                        if not message.text:
                            continue
                        postings.append(
                            RawJobPosting(
                                source_name=f"telegram:{channel}",
                                external_id=str(message.id),
                                raw_text=message.text,
                                url=f"https://t.me/{channel}/{message.id}",
                            )
                        )
                except Exception as exc:
                    logger.warning("telegram:%s fetch failed: %s", channel, exc)
        return postings

    def dedupe_key(self, posting: RawJobPosting) -> str:
        return f"{posting.source_name}:{posting.external_id}"
