from datetime import date
from unittest.mock import MagicMock

from app.models.job import Job
from app.scoring.schema import FitScoreResult
from app.sheets.sheets_logger import SheetsError, log_job_to_sheets, update_tailored_resume_path


def _job(**overrides) -> Job:
    defaults = dict(
        id=1, company="Acme", role="ML Engineer", location="Remote",
        apply_url="https://acme.example/jobs/1", content_hash="h", source="test",
    )
    defaults.update(overrides)
    return Job(**defaults)


def _score(**overrides) -> FitScoreResult:
    defaults = dict(score=80, matched_item_ids=["skills-ml"], gaps=[], rationale="good fit")
    defaults.update(overrides)
    return FitScoreResult(**defaults)


def test_log_job_to_sheets_appends_expected_row():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A5:I5"}}

    row_number = log_job_to_sheets(worksheet, _job(), _score(), pdf_path="resumes/acme.pdf")

    assert row_number == 5
    worksheet.append_row.assert_called_once()
    row = worksheet.append_row.call_args[0][0]
    assert len(row) == 9
    assert row[1] == "Acme"
    assert row[2] == "ML Engineer"
    assert row[3] == "Remote"
    assert row[4] == "80/100"
    assert row[5] == "skills-ml"
    assert row[6] == ""  # no posted_date on this job
    assert row[7] == ""  # no deadline on this job
    assert row[8] == "resumes/acme.pdf"

    # No separate Link column — the apply URL is attached directly to the
    # Company cell's text as a real link (textFormatRuns).
    worksheet.spreadsheet.batch_update.assert_called_once()
    request = worksheet.spreadsheet.batch_update.call_args[0][0]["requests"][0]["updateCells"]
    assert request["range"]["startRowIndex"] == 4  # row 5, 0-indexed
    assert request["range"]["startColumnIndex"] == 1  # Company column
    cell = request["rows"][0]["values"][0]
    assert cell["userEnteredValue"]["stringValue"] == "Acme"
    assert cell["textFormatRuns"][0]["format"]["link"]["uri"] == "https://acme.example/jobs/1"


def test_log_job_includes_posted_date_and_deadline_when_present():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A2:I2"}}

    job = _job(posted_date=date(2026, 9, 1), deadline=date(2026, 12, 1))
    log_job_to_sheets(worksheet, job, _score(), pdf_path=None)

    row = worksheet.append_row.call_args[0][0]
    assert row[6] == "2026-09-01"
    assert row[7] == "2026-12-01"


def test_log_job_without_location_logs_empty_string():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A2:I2"}}

    log_job_to_sheets(worksheet, _job(location=None), _score(), pdf_path=None)

    row = worksheet.append_row.call_args[0][0]
    assert row[3] == ""


def test_log_job_without_apply_url_skips_company_link():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A2:I2"}}

    log_job_to_sheets(worksheet, _job(apply_url=None), _score(), pdf_path=None)

    assert not worksheet.spreadsheet.batch_update.called


def test_log_three_jobs_dry_run_no_real_calls():
    """Dry-run: build rows for 3 jobs without touching a real worksheet."""
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A2:I2"}}

    jobs = [_job(id=i, company=f"Company{i}") for i in range(1, 4)]
    refs = [log_job_to_sheets(worksheet, job, _score(), pdf_path=None) for job in jobs]

    assert len(refs) == 3
    assert worksheet.append_row.call_count == 3


def test_log_job_missing_pdf_path_logs_empty_string():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {"updatedRange": "Sheet1!A2:I2"}}

    log_job_to_sheets(worksheet, _job(), _score(), pdf_path=None)

    row = worksheet.append_row.call_args[0][0]
    assert row[8] == ""


def test_log_job_raises_when_row_number_cannot_be_determined():
    worksheet = MagicMock()
    worksheet.append_row.return_value = {"updates": {}}

    try:
        log_job_to_sheets(worksheet, _job(), _score(), pdf_path=None)
        assert False, "expected SheetsError"
    except SheetsError:
        pass


def test_update_tailored_resume_path_writes_last_column():
    worksheet = MagicMock()

    update_tailored_resume_path(worksheet, 5, "resumes/resume5.pdf")

    worksheet.update_cell.assert_called_once_with(5, 9, "resumes/resume5.pdf")
