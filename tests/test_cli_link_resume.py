from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.cli import run_link_resume
from app.db import Base
from app.models import FitScore, Job, LinkResumeRequest, TailoredResume
from app.parsing.parser import ParseError
from app.parsing.schema import ParsedJobFields, ParseResult
from app.resume.schema import Contact, ResumeProfile
from app.rendering.drive_upload import DriveUploadError
from app.scoring.schema import FitScoreResult
from app.sources.link_paste import LinkFetchError
from app.tailoring.schema import TailoredItem, TailoredResumeContent
from app.telegram_delivery import TelegramDeliveryError


@pytest.fixture()
def sqlite_session_local(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr("app.cli.SessionLocal", SessionLocal)
    return SessionLocal


FAKE_RESUME = ResumeProfile(contact=Contact(name="Jane Doe", email="jane@example.com"))
FAKE_PARSE_RESULT = ParseResult(
    is_job=True,
    job=ParsedJobFields(company="Acme", role="ML Engineer", domain="ai_ml", skills=["Python"], keywords=["Python"]),
)


def _fake_score(job, resume):
    return FitScoreResult(score=82, matched_item_ids=["skills-ml"], gaps=[], rationale="strong match")


def _fake_tailor(resume, job, score):
    return TailoredResumeContent(
        job_id=job.id, contact=resume.contact, summary=[TailoredItem(id="s", section="summary", bullets=["x"])]
    )


def _create_pending_request(SessionLocal, url: str) -> int:
    with SessionLocal() as session:
        row = LinkResumeRequest(url=url, status="pending")
        session.add(row)
        session.commit()
        return row.id


def test_full_run_sends_whatsapp_and_marks_request_done(sqlite_session_local, tmp_path):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/jobs/1")

    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring an ML Engineer"),
        patch("app.cli.parse_raw_post", return_value=FAKE_PARSE_RESULT),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/file/d/abc/view"),
        patch("app.cli.send_resume_document") as whatsapp_mock,
        patch("app.cli.notify_resume_ready") as notify_mock,
    ):
        result = run_link_resume("https://example.com/jobs/1", request_id=request_id)

    assert result["status"] == "done"
    assert result["score"] == 82
    assert result["drive_link"] == "https://drive.google.com/file/d/abc/view"
    assert result["whatsapp_status"] == "sent"
    whatsapp_mock.assert_called_once()
    assert "Acme" in whatsapp_mock.call_args[0][1]
    notify_mock.assert_called_once_with("Acme", "ML Engineer", 82, "https://drive.google.com/file/d/abc/view")

    with sqlite_session_local() as session:
        job = session.query(Job).one()
        assert job.company == "Acme"
        assert job.status == "tailored"
        assert job.source == "link_paste"
        assert session.query(FitScore).count() == 1
        assert session.query(TailoredResume).count() == 1

        request_row = session.get(LinkResumeRequest, request_id)
        assert request_row.status == "done"
        assert request_row.job_id == job.id
        assert request_row.score == 82
        assert request_row.whatsapp_status == "sent"
        assert request_row.completed_at is not None


def test_reuses_existing_job_matched_by_apply_url_not_content_hash(sqlite_session_local, tmp_path):
    # Simulates the real bug: a source adapter already tracked this exact
    # URL under its own JD parse (a different company/role/location text
    # than link_paste's parse of the same page lands on), so content_hash
    # differs — only apply_url actually matches. Used to crash the whole
    # request on jobs' apply_url unique constraint instead of reusing the
    # row.
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/jobs/1")
    with sqlite_session_local() as session:
        existing = Job(
            company="Acme Inc.",  # deliberately different text than FAKE_PARSE_RESULT's "Acme"
            role="Machine Learning Engineer",
            source="greenhouse",
            apply_url="https://example.com/jobs/1",
            content_hash="some-other-hash-from-the-real-pipelines-own-parse",
            status="new",
        )
        session.add(existing)
        session.commit()
        existing_id = existing.id

    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring an ML Engineer"),
        patch("app.cli.parse_raw_post", return_value=FAKE_PARSE_RESULT),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/file/d/abc/view"),
        patch("app.cli.send_resume_document"),
    ):
        result = run_link_resume("https://example.com/jobs/1", request_id=request_id)

    assert result["status"] == "done"
    assert result["job_id"] == existing_id
    with sqlite_session_local() as session:
        assert session.query(Job).count() == 1  # reused, not duplicated


def test_fetch_failure_marks_request_failed(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/dead")

    with patch("app.cli.fetch_job_page_text", side_effect=LinkFetchError("HTTP 404")):
        result = run_link_resume("https://example.com/dead", request_id=request_id)

    assert result["status"] == "failed"
    with sqlite_session_local() as session:
        request_row = session.get(LinkResumeRequest, request_id)
        assert request_row.status == "failed"
        assert "HTTP 404" in request_row.error
        assert session.query(Job).count() == 0


def test_parse_error_marks_request_failed(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/weird")

    with (
        patch("app.cli.fetch_job_page_text", return_value="garbled text"),
        patch("app.cli.parse_raw_post", side_effect=ParseError("bad json")),
    ):
        result = run_link_resume("https://example.com/weird", request_id=request_id)

    assert result["status"] == "failed"
    with sqlite_session_local() as session:
        assert session.get(LinkResumeRequest, request_id).status == "failed"


def test_non_job_page_marks_request_failed(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/blog-post")
    not_a_job = ParseResult(is_job=False, job=None, reason="this is a blog post")

    with (
        patch("app.cli.fetch_job_page_text", return_value="some blog content"),
        patch("app.cli.parse_raw_post", return_value=not_a_job),
    ):
        result = run_link_resume("https://example.com/blog-post", request_id=request_id)

    assert result["status"] == "failed"
    with sqlite_session_local() as session:
        assert session.get(LinkResumeRequest, request_id).status == "failed"


def test_unprepared_domain_marks_request_failed(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/jobs/2")
    data_science_result = ParseResult(
        is_job=True, job=ParsedJobFields(company="Acme", role="Data Analyst", domain="data_science")
    )

    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring a Data Analyst"),
        patch("app.cli.parse_raw_post", return_value=data_science_result),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
    ):
        result = run_link_resume("https://example.com/jobs/2", request_id=request_id)

    assert result["status"] == "failed"
    assert "data_science" in result["error"]


def test_whatsapp_failure_does_not_fail_the_whole_request(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/jobs/3")

    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring an ML Engineer"),
        patch("app.cli.parse_raw_post", return_value=FAKE_PARSE_RESULT),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/file/d/xyz/view"),
        patch("app.cli.send_resume_document", side_effect=TelegramDeliveryError("token expired")),
    ):
        result = run_link_resume("https://example.com/jobs/3", request_id=request_id)

    assert result["status"] == "done"
    assert result["drive_link"] == "https://drive.google.com/file/d/xyz/view"
    assert "failed" in result["whatsapp_status"]
    assert "token expired" in result["whatsapp_status"]


def test_drive_upload_failure_still_completes_request(sqlite_session_local):
    request_id = _create_pending_request(sqlite_session_local, "https://example.com/jobs/4")

    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring an ML Engineer"),
        patch("app.cli.parse_raw_post", return_value=FAKE_PARSE_RESULT),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", side_effect=DriveUploadError("not configured")),
        patch("app.cli.send_resume_document") as whatsapp_mock,
    ):
        result = run_link_resume("https://example.com/jobs/4", request_id=request_id)

    assert result["status"] == "done"
    assert result["drive_link"] is None
    whatsapp_mock.assert_called_once()  # still tries to send even without a Drive link


def test_works_without_a_request_id(sqlite_session_local):
    with (
        patch("app.cli.fetch_job_page_text", return_value="Acme is hiring an ML Engineer"),
        patch("app.cli.parse_raw_post", return_value=FAKE_PARSE_RESULT),
        patch("app.cli._load_domain_resumes", return_value={"ai_ml": FAKE_RESUME}),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/file/d/abc/view"),
        patch("app.cli.send_resume_document"),
    ):
        result = run_link_resume("https://example.com/jobs/1")

    assert result["status"] == "done"
    with sqlite_session_local() as session:
        assert session.query(LinkResumeRequest).count() == 0
