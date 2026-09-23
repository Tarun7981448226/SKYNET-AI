"""Google Sheets logging via a read/write service account (gspread). See
secrets-hygiene: credentials only read from settings, never printed/logged."""

import re
from datetime import date

from app.config import settings
from app.models.job import Job
from app.scoring.schema import FitScoreResult

HEADER_ROW = [
    "Date Logged",
    "Company",
    "Role",
    "Location",
    "Score",
    "Skills Match",
    "Job Posted",
    "Deadline",
    "Tailored Resume",
]
# Fixed pixel widths, sized for the data each column actually holds (not
# just the header label) — auto-resize at header-creation time was sizing
# columns to short header text, truncating real values once rows arrived.
_COLUMN_WIDTHS = [110, 140, 260, 180, 80, 300, 100, 100, 320]
# 0-indexed columns whose values read better centered (short/fixed-shape);
# long free text (Company, Role, Location, Skills Match, Tailored Resume) stays left.
_CENTERED_COLUMNS = {0, 4, 6, 7}
# Long free-text columns wrap instead of clipping/overflowing into a
# neighboring cell (which only worked when that neighbor was empty — a job
# with, say, both Skills Match and Job Posted populated was getting its
# Skills Match text cut off at the column boundary).
_WRAP_COLUMNS = {1, 2, 3, 5, 8}  # Company, Role, Location, Skills Match, Tailored Resume
_FONT_FAMILY = "Times New Roman"
_LOCATION_COLUMN_INDEX = 3  # 0-indexed; used by the existing-sheet migration below

_ROW_REF_RE = re.compile(r"![A-Z]+(\d+):")


class SheetsError(Exception):
    pass


def _apply_sheet_formatting(worksheet) -> None:
    """Only ever called from init_sheets() the moment the header row is
    first created (i.e. before any data/links exist). DO NOT call this
    again on a sheet that already has rows: its broad textFormat writes
    replace each cell's whole textFormat object, silently wiping any
    per-cell link set by _set_company_link (fields masks in the Sheets API
    are per top-level key here, not deep-merged)."""
    num_cols = len(HEADER_ROW)
    last_col = chr(ord("A") + num_cols - 1)
    sheet_id = worksheet.id

    dimension_requests = [
        {
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": i, "endIndex": i + 1},
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        }
        for i, width in enumerate(_COLUMN_WIDTHS)
    ]
    worksheet.spreadsheet.batch_update({"requests": dimension_requests})

    # No fixed row height: wrapped cells (see _WRAP_COLUMNS) need Sheets'
    # normal auto-fit-to-content row sizing, which a hard pixelSize would
    # override and clip.
    worksheet.format(
        f"A1:{last_col}1000",
        {
            "textFormat": {"fontFamily": _FONT_FAMILY},
            "padding": {"top": 4, "bottom": 4, "left": 6, "right": 6},
            "verticalAlignment": "MIDDLE",
        },
    )
    worksheet.format(
        f"A1:{last_col}1",
        {"textFormat": {"bold": True, "fontFamily": _FONT_FAMILY}, "horizontalAlignment": "CENTER"},
    )
    for i in _CENTERED_COLUMNS:
        col = chr(ord("A") + i)
        worksheet.format(f"{col}2:{col}1000", {"horizontalAlignment": "CENTER"})
    for i in _WRAP_COLUMNS:
        col = chr(ord("A") + i)
        worksheet.format(f"{col}2:{col}1000", {"wrapStrategy": "WRAP"})


def _ensure_location_column(worksheet) -> None:
    """Migration for sheets created before the Location column existed:
    inserts it after Role, shifting Score/Skills Match/etc. right so
    already-logged rows keep their existing values correctly aligned under
    the new header (historical rows just get a blank Location cell — we
    don't have their location handy to backfill). No-op once the header
    already has it, including on a sheet whose header row was just created
    fresh with HEADER_ROW (which already includes it)."""
    header = worksheet.row_values(1)
    if "Location" in header:
        return
    worksheet.insert_cols([["Location"]], col=_LOCATION_COLUMN_INDEX + 1)
    col = chr(ord("A") + _LOCATION_COLUMN_INDEX)
    worksheet.format(
        f"{col}1", {"textFormat": {"bold": True, "fontFamily": _FONT_FAMILY}, "horizontalAlignment": "CENTER"}
    )
    worksheet.format(
        f"{col}2:{col}1000",
        {
            "textFormat": {"fontFamily": _FONT_FAMILY},
            "wrapStrategy": "WRAP",
            "padding": {"top": 4, "bottom": 4, "left": 6, "right": 6},
            "verticalAlignment": "MIDDLE",
        },
    )
    worksheet.spreadsheet.batch_update(
        {
            "requests": [
                {
                    "updateDimensionProperties": {
                        "range": {
                            "sheetId": worksheet.id,
                            "dimension": "COLUMNS",
                            "startIndex": _LOCATION_COLUMN_INDEX,
                            "endIndex": _LOCATION_COLUMN_INDEX + 1,
                        },
                        "properties": {"pixelSize": _COLUMN_WIDTHS[_LOCATION_COLUMN_INDEX]},
                        "fields": "pixelSize",
                    }
                }
            ]
        }
    )


def init_sheets():
    import gspread

    if not settings.google_sheets_id:
        raise SheetsError("GOOGLE_SHEETS_ID is not set in .env")

    try:
        client = gspread.service_account(filename=settings.google_sheets_credentials_path)
        spreadsheet = client.open_by_key(settings.google_sheets_id)
    except FileNotFoundError as exc:
        raise SheetsError(f"Sheets credentials file not found: {settings.google_sheets_credentials_path}") from exc

    worksheet = spreadsheet.sheet1
    if worksheet.row_count == 0 or not worksheet.row_values(1):
        worksheet.append_row(HEADER_ROW, value_input_option="USER_ENTERED")
        _apply_sheet_formatting(worksheet)
    else:
        _ensure_location_column(worksheet)
    return worksheet


def _row_number_from_response(response: dict) -> int | None:
    updated_range = (response or {}).get("updates", {}).get("updatedRange", "")
    match = _ROW_REF_RE.search(updated_range)
    return int(match.group(1)) if match else None


_COMPANY_COLUMN_INDEX = 1  # 0-indexed


def _set_company_link(worksheet, row: int, company: str, url: str) -> None:
    """Attaches a real link directly to the Company cell's text (Sheets'
    native 'Insert link' feature, via textFormatRuns) — a cell that already
    holds a =HYPERLINK() formula (the Link column) can't also carry this,
    which is why 'Insert link' wasn't offered there in the Sheets UI."""
    worksheet.spreadsheet.batch_update(
        {
            "requests": [
                {
                    "updateCells": {
                        "range": {
                            "sheetId": worksheet.id,
                            "startRowIndex": row - 1,
                            "endRowIndex": row,
                            "startColumnIndex": _COMPANY_COLUMN_INDEX,
                            "endColumnIndex": _COMPANY_COLUMN_INDEX + 1,
                        },
                        "rows": [
                            {
                                "values": [
                                    {
                                        "userEnteredValue": {"stringValue": company},
                                        "textFormatRuns": [
                                            {"startIndex": 0, "format": {"link": {"uri": url}}}
                                        ],
                                    }
                                ]
                            }
                        ],
                        "fields": "userEnteredValue,textFormatRuns",
                    }
                }
            ]
        }
    )


_RESUME_COLUMN_INDEX = len(HEADER_ROW) - 1  # 0-indexed; Tailored Resume is the last column


def log_job_to_sheets(worksheet, job: Job, score: FitScoreResult, pdf_path: str | None) -> int:
    """Appends one row and returns the 1-indexed row number it landed on —
    used by the caller to name that job's resume file after the row (e.g.
    row 5 -> resume5.pdf), via a follow-up update_tailored_resume_path()
    call once the file has actually been generated. The apply URL isn't a
    separate column — see _set_company_link."""
    row = [
        date.today().isoformat(),
        job.company,
        job.role,
        job.location or "",
        f"{score.score}/100",
        ", ".join(score.matched_item_ids),
        job.posted_date.isoformat() if job.posted_date else "",
        job.deadline.isoformat() if job.deadline else "",
        pdf_path or "",
    ]
    response = worksheet.append_row(row, value_input_option="USER_ENTERED")
    row_number = _row_number_from_response(response)
    if row_number is None:
        raise SheetsError(f"Could not determine the row Sheets assigned: {response}")
    if job.apply_url:
        _set_company_link(worksheet, row_number, job.company, job.apply_url)
    return row_number


def log_flagged_job_to_sheets(worksheet, job: Job, domain: str | None) -> int:
    """Appends a row for a job whose domain has no prepared resume yet (see
    run_tailor()'s _DOMAIN_RESUME_PATHS) — no score/tailoring happened, so
    Score/Skills Match stay blank and the Tailored Resume column carries a
    note instead of a path/link, telling you which domain resume to add."""
    row = [
        date.today().isoformat(),
        job.company,
        job.role,
        job.location or "",
        "",
        "",
        job.posted_date.isoformat() if job.posted_date else "",
        job.deadline.isoformat() if job.deadline else "",
        f"FLAGGED: no resume prepared for domain '{domain or 'unknown'}' — add data/resume_{domain or 'unknown'}.md",
    ]
    response = worksheet.append_row(row, value_input_option="USER_ENTERED")
    row_number = _row_number_from_response(response)
    if row_number is None:
        raise SheetsError(f"Could not determine the row Sheets assigned: {response}")
    if job.apply_url:
        _set_company_link(worksheet, row_number, job.company, job.apply_url)
    return row_number


def update_tailored_resume_path(worksheet, row_number: int, pdf_path: str) -> None:
    worksheet.update_cell(row_number, _RESUME_COLUMN_INDEX + 1, pdf_path)  # update_cell is 1-indexed
