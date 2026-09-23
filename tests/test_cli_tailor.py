import argparse
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.cli import (
    backfill_drive_links,
    cleanup_rejected_resumes,
    retailor_scored_jobs,
    gap_report,
    reclassify_senior_scored_jobs,
    _looks_senior,
    cmd_tailor,
    cmd_jobs_status,
)
from app.db import Base
from app.models import FitScore, Job, SheetSyncLog, TailoredResume
from app.rendering.drive_upload import DriveUploadError
from app.resume.schema import Contact, ResumeProfile
from app.scoring.schema import FitScoreResult
from app.tailoring.schema import TailoredItem, TailoredResumeContent


@pytest.fixture()
def sqlite_session_local(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    monkeypatch.setattr("app.cli.SessionLocal", SessionLocal)
    return SessionLocal


def _seed_jobs(SessionLocal, n: int, domain: str = "ai_ml"):
    with SessionLocal() as session:
        for i in range(n):
            session.add(
                Job(
                    company=f"Company{i}",
                    role="ML Engineer",
                    content_hash=f"hash{i}",
                    source="test",
                    status="new",
                    domain=domain,
                )
            )
        session.commit()


FAKE_RESUME = ResumeProfile(contact=Contact(name="Jane Doe", email="jane@example.com"))


def _fake_score(job, resume):
    return FitScoreResult(score=70, matched_item_ids=["skills-ml"], gaps=[], rationale="ok")


def _fake_tailor(resume, job, score):
    return TailoredResumeContent(
        job_id=job.id, contact=resume.contact, summary=[TailoredItem(id="s", section="summary", bullets=["x"])]
    )


def test_dry_run_scores_but_does_not_tailor_or_log(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 2)

    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor) as tailor_mock,
        patch("app.cli.generate_pdf") as pdf_mock,
        patch("app.cli.generate_docx") as docx_mock,
        patch("app.cli.init_sheets") as sheets_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=True))

    assert not pdf_mock.called
    assert not docx_mock.called
    assert not sheets_mock.called
    assert tailor_mock.called  # still tailors in-memory for the printed preview

    with sqlite_session_local() as session:
        jobs = session.query(Job).all()
        assert all(j.status == "scored" for j in jobs)
        assert session.query(FitScore).count() == 2
        assert session.query(TailoredResume).count() == 0


def test_full_run_creates_tailored_resume_and_logs_to_sheets(sqlite_session_local, tmp_path):
    _seed_jobs(sqlite_session_local, 1)

    fake_worksheet = MagicMock()
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf") as pdf_mock,
        patch("app.cli.generate_docx") as docx_mock,
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_job_to_sheets", return_value=2) as log_mock,
        patch("app.cli.upload_to_drive", return_value="resumes/resume2.pdf"),
        patch("app.cli.update_tailored_resume_path") as update_path_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=False))

    assert pdf_mock.called
    assert docx_mock.called
    assert log_mock.called
    # Resume is named after its Sheet row (row 2 -> resume2.pdf), not the job id.
    assert pdf_mock.call_args[0][1] == "resumes/resume2.pdf"
    update_path_mock.assert_called_once_with(fake_worksheet, 2, "resumes/resume2.pdf")

    with sqlite_session_local() as session:
        job = session.query(Job).first()
        assert job.status == "tailored"
        assert session.query(TailoredResume).count() == 1
        assert session.query(SheetSyncLog).count() == 1


def test_full_run_persists_drive_link_on_tailored_resume(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)

    fake_worksheet = MagicMock()
    drive_url = "https://drive.google.com/file/d/abc123/view"
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf"),
        patch("app.cli.generate_docx"),
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_job_to_sheets", return_value=2),
        patch("app.cli.upload_to_drive", return_value=drive_url),
        patch("app.cli.update_tailored_resume_path"),
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=False))

    with sqlite_session_local() as session:
        tailored_resume = session.query(TailoredResume).first()
        assert tailored_resume.drive_link == drive_url
        # pdf_path stays the local (ephemeral) path — drive_link is additive.
        assert tailored_resume.pdf_path == "resumes/resume2.pdf"


def test_full_run_notifies_push_with_company_role_score_and_drive_link(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)

    fake_worksheet = MagicMock()
    drive_url = "https://drive.google.com/file/d/abc123/view"
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf"),
        patch("app.cli.generate_docx"),
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_job_to_sheets", return_value=2),
        patch("app.cli.upload_to_drive", return_value=drive_url),
        patch("app.cli.update_tailored_resume_path"),
        patch("app.cli.notify_resume_ready") as notify_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=False))

    notify_mock.assert_called_once_with("Company0", "ML Engineer", 70, drive_url)


def test_backfill_drive_links_repairs_rows_missing_a_drive_link(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        content = TailoredResumeContent(
            job_id=job.id, contact=FAKE_RESUME.contact, summary=[TailoredItem(id="s", section="summary", bullets=["x"])]
        )
        session.add(
            TailoredResume(
                job_id=job.id,
                tailored_content=content.model_dump(),
                pdf_path="resumes/resume1.pdf",  # stale local path from a prior, long-gone run
                docx_path="resumes/resume1.docx",
                drive_link=None,
            )
        )
        session.commit()

    drive_url = "https://drive.google.com/file/d/backfilled/view"
    with (
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.upload_to_drive", return_value=drive_url) as upload_mock,
    ):
        counts = backfill_drive_links(limit=10)

    assert counts == {"repaired": 1, "failed": 0}
    upload_mock.assert_called_once_with("resumes/backfill1.pdf")
    with sqlite_session_local() as session:
        tailored_resume = session.query(TailoredResume).first()
        assert tailored_resume.drive_link == drive_url


def test_backfill_drive_links_skips_rows_that_already_have_one(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        session.add(
            TailoredResume(
                job_id=job.id,
                tailored_content={"job_id": job.id, "contact": {"name": "Jane Doe", "email": "jane@example.com"}},
                drive_link="https://drive.google.com/already-there",
            )
        )
        session.commit()

    with patch("app.cli.upload_to_drive") as upload_mock:
        counts = backfill_drive_links(limit=10)

    assert counts == {"repaired": 0, "failed": 0}
    upload_mock.assert_not_called()


def test_backfill_drive_links_continues_after_one_row_fails(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 2)
    with sqlite_session_local() as session:
        for job in session.query(Job).all():
            content = TailoredResumeContent(
                job_id=job.id,
                contact=FAKE_RESUME.contact,
                summary=[TailoredItem(id="s", section="summary", bullets=["x"])],
            )
            session.add(TailoredResume(job_id=job.id, tailored_content=content.model_dump(), drive_link=None))
        session.commit()

    with (
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch(
            "app.cli.upload_to_drive",
            side_effect=[DriveUploadError("quota exceeded"), "https://drive.google.com/ok"],
        ),
    ):
        counts = backfill_drive_links(limit=10)

    assert counts == {"repaired": 1, "failed": 1}


def test_cleanup_rejected_resumes_trashes_and_clears_drive_link(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        job.user_decision = "rejected"
        session.add(
            TailoredResume(
                job_id=job.id,
                tailored_content={"job_id": job.id, "contact": {"name": "Jane Doe", "email": "jane@example.com"}},
                drive_link="https://drive.google.com/file/d/abc123/view?usp=drivesdk",
            )
        )
        session.commit()

    with patch("app.cli.trash_drive_file") as trash_mock:
        counts = cleanup_rejected_resumes(limit=10)

    assert counts == {"cleaned": 1, "failed": 0}
    trash_mock.assert_called_once_with("https://drive.google.com/file/d/abc123/view?usp=drivesdk")
    with sqlite_session_local() as session:
        tailored_resume = session.query(TailoredResume).first()
        assert tailored_resume.drive_link is None


def test_cleanup_rejected_resumes_ignores_non_rejected_jobs(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        # not rejected — still pending a decision
        session.add(
            TailoredResume(
                job_id=job.id,
                tailored_content={"job_id": job.id, "contact": {"name": "Jane Doe", "email": "jane@example.com"}},
                drive_link="https://drive.google.com/file/d/abc123/view",
            )
        )
        session.commit()

    with patch("app.cli.trash_drive_file") as trash_mock:
        counts = cleanup_rejected_resumes(limit=10)

    assert counts == {"cleaned": 0, "failed": 0}
    trash_mock.assert_not_called()


def test_cleanup_rejected_resumes_continues_after_one_failure(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 2)
    with sqlite_session_local() as session:
        for job in session.query(Job).all():
            job.user_decision = "rejected"
            session.add(
                TailoredResume(
                    job_id=job.id,
                    tailored_content={
                        "job_id": job.id,
                        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
                    },
                    drive_link=f"https://drive.google.com/file/d/{job.id}/view",
                )
            )
        session.commit()

    with patch("app.cli.trash_drive_file", side_effect=[Exception("Drive API down"), None]):
        counts = cleanup_rejected_resumes(limit=10)

    assert counts == {"cleaned": 1, "failed": 1}


def _seed_scored_job(SessionLocal, score: int, domain: str = "ai_ml"):
    with SessionLocal() as session:
        job = Job(
            company="Datadog",
            role="Senior Applied Scientist",
            content_hash=f"scoredhash-{score}-{domain}-{id(object())}",
            source="test",
            status="scored",
            domain=domain,
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(FitScore(job_id=job.id, score=score, matched_item_ids=["skills-ml"], gaps=[], rationale="ok"))
        session.commit()
        return job.id


def test_retailor_scored_jobs_tailors_a_job_that_cleared_a_lowered_threshold(sqlite_session_local):
    job_id = _seed_scored_job(sqlite_session_local, score=55)

    fake_worksheet = MagicMock()
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_job_to_sheets", return_value=3),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/file/d/retailored/view"),
        patch("app.cli.update_tailored_resume_path") as update_path_mock,
        patch("app.cli.notify_resume_ready") as notify_mock,
    ):
        counts = retailor_scored_jobs(limit=10, min_score=50)

    assert counts == {"tailored": 1, "skipped_no_resume": 0, "failed": 0}
    update_path_mock.assert_called_once_with(fake_worksheet, 3, "https://drive.google.com/file/d/retailored/view")
    # Deliberate: retailor_scored_jobs is a manual backfill command that can
    # touch many jobs at once — a push notification per row here would spam
    # a maintenance operation, not signal a genuinely new resume.
    notify_mock.assert_not_called()
    with sqlite_session_local() as session:
        job = session.get(Job, job_id)
        assert job.status == "tailored"
        tailored_resume = session.query(TailoredResume).filter_by(job_id=job_id).first()
        assert tailored_resume.drive_link == "https://drive.google.com/file/d/retailored/view"


def test_retailor_scored_jobs_ignores_jobs_still_below_the_new_threshold(sqlite_session_local):
    _seed_scored_job(sqlite_session_local, score=40)

    with patch("app.cli.tailor_resume") as tailor_mock:
        counts = retailor_scored_jobs(limit=10, min_score=50)

    assert counts == {"tailored": 0, "skipped_no_resume": 0, "failed": 0}
    tailor_mock.assert_not_called()


def test_retailor_scored_jobs_skips_domains_with_no_prepared_resume(sqlite_session_local):
    _seed_scored_job(sqlite_session_local, score=55, domain="data_science")

    with patch("app.cli.load_resume", side_effect=FileNotFoundError), patch("app.cli.tailor_resume") as tailor_mock:
        counts = retailor_scored_jobs(limit=10, min_score=50)

    assert counts == {"tailored": 0, "skipped_no_resume": 1, "failed": 0}
    tailor_mock.assert_not_called()


def test_retailor_scored_jobs_continues_after_one_failure(sqlite_session_local):
    _seed_scored_job(sqlite_session_local, score=55)
    _seed_scored_job(sqlite_session_local, score=58)

    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.tailor_resume", side_effect=[Exception("LLM down"), _fake_tailor(FAKE_RESUME, MagicMock(id=2), None)]),
        patch("app.cli.generate_pdf", return_value=1.0),
        patch("app.cli.generate_docx"),
        patch("app.cli.init_sheets", return_value=MagicMock()),
        patch("app.cli.log_job_to_sheets", return_value=4),
        patch("app.cli.upload_to_drive", return_value="https://drive.google.com/ok"),
        patch("app.cli.update_tailored_resume_path"),
    ):
        counts = retailor_scored_jobs(limit=10, min_score=50)

    assert counts == {"tailored": 1, "skipped_no_resume": 0, "failed": 1}


def _seed_job_with_gaps(SessionLocal, domain: str, score: int, gaps: list[str]):
    with SessionLocal() as session:
        job = Job(
            company="TestCo",
            role="Test Role",
            content_hash=f"gaphash-{domain}-{score}-{id(object())}",
            source="test",
            status="scored",
            domain=domain,
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(FitScore(job_id=job.id, score=score, matched_item_ids=[], gaps=gaps, rationale="ok"))
        session.commit()


def test_gap_report_counts_recurring_gaps_per_domain(sqlite_session_local):
    _seed_job_with_gaps(sqlite_session_local, "ai_ml", 55, ["Statistics", "Distributed Systems"])
    _seed_job_with_gaps(sqlite_session_local, "ai_ml", 60, ["statistics"])
    _seed_job_with_gaps(sqlite_session_local, "swe", 30, ["Kubernetes", "Go"])

    report = gap_report()

    assert report["ai_ml"]["job_count"] == 2
    assert report["ai_ml"]["avg_score"] == 57.5
    assert report["ai_ml"]["top_gaps"][0] == ("statistics", 2)
    assert report["swe"]["job_count"] == 1


def test_gap_report_filters_by_domain(sqlite_session_local):
    _seed_job_with_gaps(sqlite_session_local, "ai_ml", 55, ["statistics"])
    _seed_job_with_gaps(sqlite_session_local, "swe", 30, ["kubernetes"])

    report = gap_report(domain="swe")

    assert list(report.keys()) == ["swe"]


def test_gap_report_respects_limit(sqlite_session_local):
    _seed_job_with_gaps(sqlite_session_local, "ai_ml", 50, ["a", "b", "c", "d"])

    report = gap_report(limit=2)

    assert len(report["ai_ml"]["top_gaps"]) == 2


def test_gap_report_returns_empty_dict_with_no_scored_jobs(sqlite_session_local):
    assert gap_report() == {}


@pytest.mark.parametrize(
    "role",
    [
        "Staff Software Engineer - Logs Management",
        "Senior Software Engineer - Frontend",
        "Manager I, Engineering - Husky",
        "Technical Account Manager 2 - Boston",
        "Technical Support Engineer II",
        "Senior Security Engineer, Vulnerability Management",
        "Staff Developer Advocate - Asia Pacific",
        "Services Architect 3 - Denver",
        "Director of Engineering",
    ],
)
def test_looks_senior_flags_real_non_entry_titles(role):
    assert _looks_senior(role) is True


@pytest.mark.parametrize(
    "role",
    [
        "Software Engineer, Early Career",
        "Full Stack Software Engineer, Credit Cards & Banking",
        "Frontend Software Engineering Intern 2027",
        "Software Engineer Intern",
        "Engineer I",
        "Android Engineer, Social",
        "AI/ML Engineer and Researcher",
    ],
)
def test_looks_senior_does_not_flag_real_entry_level_titles(role):
    assert _looks_senior(role) is False


def test_run_tailor_flags_senior_titles_without_scoring(sqlite_session_local):
    with sqlite_session_local() as session:
        session.add(
            Job(
                company="Datadog",
                role="Staff Software Engineer - Logs Management",
                content_hash="seniorhash",
                source="test",
                status="new",
                domain="swe",
            )
        )
        session.commit()

    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job") as score_mock,
        patch("app.cli.init_sheets") as sheets_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=True))

    score_mock.assert_not_called()
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        assert job.status == "flagged_seniority_mismatch"
        assert session.query(FitScore).count() == 0


def test_reclassify_senior_scored_jobs_flags_a_scored_senior_role_and_trashes_its_resume(sqlite_session_local):
    with sqlite_session_local() as session:
        job = Job(
            company="Datadog",
            role="Technical Account Manager",
            content_hash="reclassifyhash1",
            source="test",
            status="tailored",
            domain="swe",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(
            TailoredResume(
                job_id=job.id,
                tailored_content={"job_id": job.id, "contact": {"name": "Jane Doe", "email": "jane@example.com"}},
                drive_link="https://drive.google.com/file/d/uselessresume/view",
            )
        )
        session.commit()

    with patch("app.cli.trash_drive_file") as trash_mock:
        counts = reclassify_senior_scored_jobs(limit=100)

    assert counts == {"reclassified": 1, "resumes_trashed": 1, "failed": 0}
    trash_mock.assert_called_once_with("https://drive.google.com/file/d/uselessresume/view")
    with sqlite_session_local() as session:
        job = session.query(Job).first()
        assert job.status == "flagged_seniority_mismatch"
        tailored_resume = session.query(TailoredResume).first()
        assert tailored_resume.drive_link is None


def test_reclassify_senior_scored_jobs_ignores_genuinely_entry_level_roles(sqlite_session_local):
    with sqlite_session_local() as session:
        session.add(
            Job(
                company="Stripe",
                role="Software Engineer, Early Career",
                content_hash="reclassifyhash2",
                source="test",
                status="scored",
                domain="swe",
            )
        )
        session.commit()

    with patch("app.cli.trash_drive_file") as trash_mock:
        counts = reclassify_senior_scored_jobs(limit=100)

    assert counts == {"reclassified": 0, "resumes_trashed": 0, "failed": 0}
    trash_mock.assert_not_called()
    with sqlite_session_local() as session:
        assert session.query(Job).first().status == "scored"


def test_reclassify_senior_scored_jobs_skips_trashing_when_no_resume_was_ever_made(sqlite_session_local):
    with sqlite_session_local() as session:
        session.add(
            Job(
                company="Datadog",
                role="Senior Applied Scientist",
                content_hash="reclassifyhash3",
                source="test",
                status="scored",
                domain="ai_ml",
            )
        )
        session.commit()

    with patch("app.cli.trash_drive_file") as trash_mock:
        counts = reclassify_senior_scored_jobs(limit=100)

    assert counts == {"reclassified": 1, "resumes_trashed": 0, "failed": 0}
    trash_mock.assert_not_called()


def test_sheets_logging_failure_falls_back_to_job_id_naming(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1)

    fake_worksheet = MagicMock()
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.generate_pdf") as pdf_mock,
        patch("app.cli.generate_docx"),
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_job_to_sheets", side_effect=RuntimeError("Sheets API down")),
        patch("app.cli.update_tailored_resume_path") as update_path_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=False))

    assert not update_path_mock.called
    pdf_path = pdf_mock.call_args[0][1]
    assert pdf_path.startswith("resumes/Jane_Doe_")

    with sqlite_session_local() as session:
        assert session.query(SheetSyncLog).count() == 0
        assert session.query(TailoredResume).count() == 1


def test_scoring_failure_marks_error_and_continues(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 2)

    from app.scoring.scorer import ScoreError

    call_count = {"n": 0}

    def flaky_score(job, resume):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise ScoreError("bad json")
        return _fake_score(job, resume)

    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=flaky_score),
        patch("app.cli.tailor_resume", side_effect=_fake_tailor),
        patch("app.cli.init_sheets") as sheets_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=True))

    assert not sheets_mock.called
    with sqlite_session_local() as session:
        assert session.query(FitScore).count() == 1


def test_unmatched_domain_is_flagged_not_scored(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1, domain="data_science")

    fake_worksheet = MagicMock()
    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score) as score_mock,
        patch("app.cli.tailor_resume", side_effect=_fake_tailor) as tailor_mock,
        patch("app.cli.init_sheets", return_value=fake_worksheet),
        patch("app.cli.log_flagged_job_to_sheets", return_value=2) as flag_log_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=False))

    assert not score_mock.called
    assert not tailor_mock.called
    assert flag_log_mock.called

    with sqlite_session_local() as session:
        job = session.query(Job).first()
        assert job.status == "flagged_no_resume"
        assert session.query(FitScore).count() == 0
        assert session.query(TailoredResume).count() == 0


def test_missing_domain_is_also_flagged(sqlite_session_local):
    _seed_jobs(sqlite_session_local, 1, domain=None)

    with (
        patch("app.cli.load_resume", return_value=FAKE_RESUME),
        patch("app.cli.score_job", side_effect=_fake_score) as score_mock,
        patch("app.cli.init_sheets") as sheets_mock,
    ):
        cmd_tailor(argparse.Namespace(limit=5, dry_run=True))

    assert not score_mock.called
    assert not sheets_mock.called  # dry_run: worksheet never even initialized for flagging

    with sqlite_session_local() as session:
        assert session.query(Job).first().status == "flagged_no_resume"


def test_jobs_status_prints_summary(sqlite_session_local, capsys):
    with sqlite_session_local() as session:
        job = Job(company="Acme", role="SWE", content_hash="h", source="test", status="scored")
        session.add(job)
        session.commit()
        session.add(
            FitScore(job_id=job.id, score=75, matched_item_ids=[], gaps=[], rationale="ok", visa_flag=False)
        )
        session.commit()

    cmd_jobs_status(argparse.Namespace())
    out = capsys.readouterr().out
    assert "Jobs by status" in out
    assert "Scores: n=1" in out
