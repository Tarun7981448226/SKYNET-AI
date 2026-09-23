from datetime import date

from pydantic import BaseModel


class ParsedJobFields(BaseModel):
    company: str
    role: str
    type: str | None = None
    location: str | None = None
    skills: list[str] = []
    keywords: list[str] = []
    visa_notes: str | None = None
    deadline: date | None = None
    apply_url: str | None = None
    domain: str | None = None  # ai_ml / swe / data_science / other; see parser.py's _normalize_domain


class ParseResult(BaseModel):
    is_job: bool
    job: ParsedJobFields | None = None
    reason: str | None = None
