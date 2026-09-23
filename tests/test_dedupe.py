import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.dedupe import compute_hash
from app.models import Job, RawPost, Source


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as s:
        yield s


def test_compute_hash_is_stable_and_case_insensitive():
    a = compute_hash("OpenAI", "  ML Engineer  ", "SF")
    b = compute_hash("openai", "ml engineer", "sf")
    assert a == b


def test_compute_hash_differs_on_content():
    assert compute_hash("OpenAI", "ML Engineer") != compute_hash("OpenAI", "SWE")


def test_raw_post_duplicate_source_external_id_rejected(session):
    source = Source(name="greenhouse:openai", type="greenhouse")
    session.add(source)
    session.commit()

    session.add(RawPost(source_id=source.id, external_id="42", raw_text="a", content_hash="h1"))
    session.commit()

    session.add(RawPost(source_id=source.id, external_id="42", raw_text="a again", content_hash="h2"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_job_duplicate_content_hash_rejected(session):
    session.add(Job(company="OpenAI", role="MLE", source="greenhouse:openai", content_hash="dup"))
    session.commit()

    session.add(Job(company="OpenAI", role="MLE (reposted)", source="lever:openai", content_hash="dup"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_job_duplicate_apply_url_rejected(session):
    session.add(
        Job(company="OpenAI", role="MLE", source="greenhouse:openai", content_hash="h1", apply_url="https://x/1")
    )
    session.commit()

    session.add(
        Job(company="OpenAI", role="MLE v2", source="lever:openai", content_hash="h2", apply_url="https://x/1")
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_multiple_jobs_with_null_apply_url_allowed(session):
    session.add(Job(company="A", role="R1", source="s", content_hash="h1", apply_url=None))
    session.add(Job(company="B", role="R2", source="s", content_hash="h2", apply_url=None))
    session.commit()
    assert session.query(Job).count() == 2
