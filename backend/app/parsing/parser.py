import json
import logging

from app.llm.base import LLMProvider
from app.llm.factory import get_llm_provider
from app.llm.json_utils import strip_code_fences
from app.parsing.schema import ParseResult

logger = logging.getLogger(__name__)


class ParseError(Exception):
    """Raised when the LLM output isn't valid JSON or fails schema validation."""


_VALID_DOMAINS = {"ai_ml", "swe", "data_science", "other"}


def _normalize_domain(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
    return normalized if normalized in _VALID_DOMAINS else None


# See the job-parsing skill: only extract what's stated, keep keywords
# literal, never guess unclear fields.
PROMPT_TEMPLATE = """You are extracting structured data from a single job posting for an ATS-style pipeline. Follow these rules strictly:
- Only extract what is explicitly stated in the text below. Never guess or infer.
- If a field isn't stated, use null (or an empty list for skills/keywords).
- "skills" are the specific technical skills/tools/requirements literally mentioned.
- "keywords" are the literal technical terms an ATS would match on (can overlap with skills).
- "visa_notes" is any text about sponsorship/visa/work-authorization requirements, verbatim or closely paraphrased; null if not mentioned.
- "deadline" is an explicit application deadline as YYYY-MM-DD; null if not stated.
- "type" is the employment type as stated (e.g. "internship", "new grad", "full-time", "contract"); null if unclear.
- "domain" classifies the role itself (not the company's industry) into exactly one of:
  "ai_ml" (the role is primarily about building/training/researching ML/DL/AI models — ML engineer, AI researcher, applied scientist, CV/NLP/LLM roles),
  "swe" (general software engineering — backend, frontend, full-stack, systems, mobile, infra/platform — with no ML-model-building focus),
  "data_science" (data science/analytics/BI/data engineering focus — statistics, dashboards, experimentation, data pipelines — distinct from building ML models),
  "other" (anything that isn't a software/ML/data engineering role at all — PM, sales, marketing, recruiting, ops, design, etc.).
  If genuinely ambiguous between two, pick the one the job title and must-have skills most emphasize; never leave it null just because it's a judgment call.
- If the text is not a job posting at all (e.g. spam, newsletter fluff, unrelated content), set "is_job" to false and "job" to null.

Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{{"is_job": true, "job": {{"company": str, "role": str, "type": str|null, "location": str|null, "skills": [str], "keywords": [str], "visa_notes": str|null, "deadline": str|null, "apply_url": str|null, "domain": "ai_ml"|"swe"|"data_science"|"other"}}, "reason": str|null}}

Job posting text:
---
{raw_text}
---
"""


def parse_raw_post(raw_text: str, url: str | None = None, llm: LLMProvider | None = None) -> ParseResult:
    provider = llm or get_llm_provider()
    prompt = PROMPT_TEMPLATE.format(raw_text=raw_text[:8000])

    response_text = provider.complete(prompt)
    cleaned = strip_code_fences(response_text)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ParseError(f"LLM did not return valid JSON: {exc}") from exc

    try:
        result = ParseResult.model_validate(data)
    except Exception as exc:
        raise ParseError(f"LLM JSON failed schema validation: {exc}") from exc

    if result.is_job and result.job:
        if not result.job.apply_url and url:
            result.job.apply_url = url
        result.job.domain = _normalize_domain(result.job.domain)

    return result
