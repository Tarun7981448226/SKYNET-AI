import argparse
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.cli import cmd_parse
from app.db import Base
from app.models import RawPost, Source


@pytest.fixture()
def sqlite_session_local(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr("app.cli.SessionLocal", SessionLocal)
    return SessionLocal


def _seed_pending_posts(SessionLocal, n: int):
    with SessionLocal() as session:
        source = Source(name="share_bot", type="share_bot")
        session.add(source)
        session.commit()
        for i in range(n):
            session.add(
                RawPost(
                    source_id=source.id,
                    external_id=f"msg:{i}",
                    raw_text=f"job text {i}",
                    content_hash=f"hash{i}",
                )
            )
        session.commit()


def test_rate_limit_style_error_stops_batch_without_marking_error(sqlite_session_local):
    _seed_pending_posts(sqlite_session_local, 3)

    with patch("app.cli.parse_raw_post", side_effect=RuntimeError("429 quota exceeded")):
        cmd_parse(argparse.Namespace(limit=20, source=None))

    with sqlite_session_local() as session:
        posts = session.query(RawPost).all()
        assert all(p.status == "pending" for p in posts)
        assert all(p.parse_error is None for p in posts)


def test_source_filter_only_targets_matching_source(sqlite_session_local):
    with sqlite_session_local() as session:
        gh_source = Source(name="greenhouse:openai", type="greenhouse")
        sb_source = Source(name="share_bot", type="share_bot")
        session.add_all([gh_source, sb_source])
        session.commit()
        session.add(RawPost(source_id=gh_source.id, external_id="1", raw_text="gh job", content_hash="h1"))
        session.add(RawPost(source_id=sb_source.id, external_id="msg:1", raw_text="sb job", content_hash="h2"))
        session.commit()

    parsed_texts = []

    def fake_parse(raw_text, url=None):
        parsed_texts.append(raw_text)
        from app.parsing.schema import ParseResult

        return ParseResult(is_job=False, job=None, reason="test")

    with patch("app.cli.parse_raw_post", side_effect=fake_parse):
        cmd_parse(argparse.Namespace(limit=20, source="share_bot"))

    assert parsed_texts == ["sb job"]
