from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import ShareBotInboxItem
from app.sources.share_bot import ShareBotAdapter


@pytest.fixture()
def sqlite_session_local(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr("app.sources.share_bot.SessionLocal", SessionLocal)
    return SessionLocal


def _seed(SessionLocal, **overrides):
    defaults = dict(telegram_message_id=1, chat_id=111, text="http://example.com/job", photo_file_id=None)
    defaults.update(overrides)
    with SessionLocal() as session:
        item = ShareBotInboxItem(**defaults)
        session.add(item)
        session.commit()
        return item.id


def test_fetch_converts_unprocessed_text_item(sqlite_session_local, monkeypatch):
    monkeypatch.setattr("app.sources.share_bot.settings.telegram_owner_chat_id", "111")
    _seed(sqlite_session_local)

    postings = ShareBotAdapter().fetch()

    assert len(postings) == 1
    assert postings[0].raw_text == "http://example.com/job"
    assert postings[0].external_id == "msg:1"

    with sqlite_session_local() as session:
        item = session.query(ShareBotInboxItem).one()
        assert item.processed is True


def test_fetch_skips_unauthorized_chat(sqlite_session_local, monkeypatch):
    monkeypatch.setattr("app.sources.share_bot.settings.telegram_owner_chat_id", "999")
    _seed(sqlite_session_local, chat_id=111)

    postings = ShareBotAdapter().fetch()

    assert postings == []
    with sqlite_session_local() as session:
        assert session.query(ShareBotInboxItem).one().processed is True


def test_fetch_ignores_already_processed_items(sqlite_session_local, monkeypatch):
    monkeypatch.setattr("app.sources.share_bot.settings.telegram_owner_chat_id", "111")
    item_id = _seed(sqlite_session_local)
    with sqlite_session_local() as session:
        item = session.get(ShareBotInboxItem, item_id)
        item.processed = True
        session.commit()

    postings = ShareBotAdapter().fetch()

    assert postings == []


def test_fetch_runs_ocr_for_photo_items(sqlite_session_local, monkeypatch):
    monkeypatch.setattr("app.sources.share_bot.settings.telegram_owner_chat_id", "111")
    _seed(sqlite_session_local, text=None, photo_file_id="file123")

    async def fake_ocr(file_id):
        return "OCR'd job text"

    with patch("app.sources.share_bot._ocr_photo", side_effect=fake_ocr):
        postings = ShareBotAdapter().fetch()

    assert len(postings) == 1
    assert postings[0].raw_text == "OCR'd job text"


def test_fetch_skips_empty_text_and_failed_ocr(sqlite_session_local, monkeypatch):
    monkeypatch.setattr("app.sources.share_bot.settings.telegram_owner_chat_id", "111")
    _seed(sqlite_session_local, text=None, photo_file_id="file123")

    async def failing_ocr(file_id):
        raise RuntimeError("ocr failed")

    with patch("app.sources.share_bot._ocr_photo", side_effect=failing_ocr):
        postings = ShareBotAdapter().fetch()

    assert postings == []
    with sqlite_session_local() as session:
        assert session.query(ShareBotInboxItem).one().processed is True


def test_dedupe_key():
    from app.sources.base import RawJobPosting

    posting = RawJobPosting(source_name="share_bot", external_id="msg:1", raw_text="x")
    assert ShareBotAdapter().dedupe_key(posting) == "share_bot:msg:1"
