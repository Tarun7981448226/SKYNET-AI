import json
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import FitScore, Job, TailoredResume


@pytest.fixture()
def sqlite_session_local(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr("app.summary.SessionLocal", SessionLocal)
    monkeypatch.setattr("app.summary.STATIC_DIR", tmp_path)
    monkeypatch.setattr("app.summary.SUMMARY_PATH", tmp_path / "summary.json")
    return SessionLocal


def _seed(SessionLocal):
    with SessionLocal() as session:
        strong = Job(company="Acme", role="ML Engineer", content_hash="h1", source="test", status="tailored")
        medium = Job(company="Widget", role="SWE", content_hash="h2", source="test", status="scored")
        low = Job(company="Blob", role="Intern", content_hash="h3", source="test", status="scored")
        unscored = Job(company="NoScore", role="TBD", content_hash="h4", source="test", status="new")
        session.add_all([strong, medium, low, unscored])
        session.commit()

        session.add(FitScore(job_id=strong.id, score=90, matched_item_ids=[], gaps=[], rationale="great", visa_flag=False))
        session.add(FitScore(job_id=medium.id, score=60, matched_item_ids=[], gaps=[], rationale="ok", visa_flag=False))
        session.add(FitScore(job_id=low.id, score=20, matched_item_ids=[], gaps=[], rationale="poor", visa_flag=False))
        session.add(TailoredResume(job_id=strong.id, tailored_content={}, pdf_path="resumes/resume1.pdf", docx_path="resumes/resume1.docx"))
        session.commit()


def test_generate_morning_summary_buckets_and_counts(sqlite_session_local, tmp_path):
    _seed(sqlite_session_local)

    with patch("app.summary.send_success_alert") as alert_mock:
        summary = generate_morning_summary_under_test()

    assert summary["total_jobs"] == 4
    assert summary["strong_matches"] == 1
    assert summary["medium_matches"] == 1
    assert summary["low_matches"] == 1
    assert summary["resumes_ready"] == 1
    assert len(summary["job_breakdown"]) == 4
    assert alert_mock.called

    saved = json.loads((tmp_path / "summary.json").read_text())
    assert saved["total_jobs"] == 4


def generate_morning_summary_under_test():
    from app.summary import generate_morning_summary

    return generate_morning_summary()


def test_load_latest_summary_missing_file_returns_error_dict(sqlite_session_local, tmp_path):
    from app.summary import load_latest_summary

    result = load_latest_summary()
    assert "error" in result
