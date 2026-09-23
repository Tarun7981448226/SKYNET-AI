import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Job, RawPost, Source


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as s:
        yield s


def test_source_round_trip(session):
    source = Source(name="greenhouse:openai", type="greenhouse")
    session.add(source)
    session.commit()
    assert session.query(Source).filter_by(name="greenhouse:openai").one().type == "greenhouse"


def test_raw_post_requires_source(session):
    source = Source(name="telegram:testchan", type="telegram")
    session.add(source)
    session.commit()

    raw_post = RawPost(
        source_id=source.id,
        external_id="123",
        raw_text="some job text",
        content_hash="abc",
    )
    session.add(raw_post)
    session.commit()
    assert raw_post.status == "pending"


def test_job_minimal_fields(session):
    job = Job(
        company="OpenAI",
        role="ML Engineer Intern",
        source="greenhouse:openai",
        content_hash="hash1",
    )
    session.add(job)
    session.commit()
    assert job.status == "new"
    assert job.skills is None
