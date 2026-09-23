from unittest.mock import AsyncMock, MagicMock, patch

from app.sources.telegram_channels import TelegramChannelsAdapter


class FakeMessage:
    def __init__(self, id: int, text: str | None):
        self.id = id
        self.text = text


def _fake_client_cm(messages):
    client = MagicMock()

    async def _aenter(*args, **kwargs):
        return client

    async def _aexit(*args, **kwargs):
        return False

    client.__aenter__ = _aenter
    client.__aexit__ = _aexit

    async def _iter_messages(channel, limit):
        for m in messages:
            yield m

    client.iter_messages = _iter_messages
    return client


def test_no_channels_configured_returns_empty(monkeypatch):
    monkeypatch.setattr("app.sources.telegram_channels.settings.telegram_job_channels", None)
    adapter = TelegramChannelsAdapter()
    assert adapter.fetch() == []


def test_fetch_returns_postings_from_configured_channels(monkeypatch):
    monkeypatch.setattr("app.sources.telegram_channels.settings.telegram_job_channels", "myjobschannel")
    monkeypatch.setattr("app.sources.telegram_channels.settings.telegram_api_id", "123")
    monkeypatch.setattr("app.sources.telegram_channels.settings.telegram_api_hash", "hash")

    messages = [FakeMessage(1, "Hiring: SWE Intern"), FakeMessage(2, None)]
    fake_client = _fake_client_cm(messages)

    with patch("telethon.TelegramClient", return_value=fake_client):
        adapter = TelegramChannelsAdapter()
        postings = adapter.fetch()

    assert len(postings) == 1
    assert postings[0].source_name == "telegram:myjobschannel"
    assert postings[0].external_id == "1"
    assert postings[0].raw_text == "Hiring: SWE Intern"


def test_dedupe_key():
    from app.sources.base import RawJobPosting

    adapter = TelegramChannelsAdapter()
    posting = RawJobPosting(source_name="telegram:mychan", external_id="7", raw_text="x")
    assert adapter.dedupe_key(posting) == "telegram:mychan:7"
