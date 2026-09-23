import json
import logging

from app.llm.base import LLMProvider
from app.llm.factory import get_llm_provider
from app.llm.json_utils import strip_code_fences
from app.models.job import Job
from app.resume.schema import ResumeProfile
from app.scoring.schema import FitScoreResult

logger = logging.getLogger(__name__)


class ScoreError(Exception):
    """Raised when the LLM output isn't valid JSON or fails schema validation."""


# See the fit-scoring skill: score only from what's genuinely in the resume,
# surface gaps rather than hiding them, never let score auto-gate anything.
PROMPT_TEMPLATE = """You are scoring how well a candidate's resume fits a specific job posting. Follow these rules strictly:
- Base the score ONLY on real overlap between the job's stated skills/keywords and the resume items' tags/keywords/bullets below. Never assume a skill is present because a related one is.
- "matched_item_ids" must only contain ids that appear in the resume item list below — never invent an id.
- "gaps" lists job requirements (from skills/keywords) that have no matching resume item, stated plainly.
- "visa_flag" is true ONLY if the job's visa/work-authorization notes explicitly require citizenship, a security clearance, or state no sponsorship is offered. If visa notes are empty/null, visa_flag is false.
- "rationale" is a short, specific sentence referencing the actual overlap and any gaps.
- "score" is 0-100, weighted toward matching the job's core stated skills over nice-to-haves.

Job posting:
- company: {company}
- role: {role}
- type: {type}
- location: {location}
- skills: {skills}
- keywords: {keywords}
- visa_notes: {visa_notes}

Candidate resume items (id | section | tags | keywords | bullets):
{resume_items}

Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:
{{"score": int, "matched_item_ids": [str], "gaps": [str], "rationale": str, "visa_flag": bool}}
"""


def _format_resume_items(resume: ResumeProfile) -> str:
    lines = []
    for item in resume.all_items():
        bullets = " / ".join(item.bullets)
        lines.append(
            f"- {item.id} | {item.section} | tags={item.tags} | keywords={item.keywords} | {bullets}"
        )
    return "\n".join(lines)


def score_job(job: Job, resume: ResumeProfile, llm: LLMProvider | None = None) -> FitScoreResult:
    provider = llm or get_llm_provider()
    prompt = PROMPT_TEMPLATE.format(
        company=job.company,
        role=job.role,
        type=job.type or "unstated",
        location=job.location or "unstated",
        skills=job.skills or [],
        keywords=job.keywords or [],
        visa_notes=job.visa_notes or "none stated",
        resume_items=_format_resume_items(resume),
    )

    response_text = provider.complete(prompt)
    cleaned = strip_code_fences(response_text)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ScoreError(f"LLM did not return valid JSON: {exc}") from exc

    try:
        result = FitScoreResult.model_validate(data)
    except Exception as exc:
        raise ScoreError(f"LLM JSON failed schema validation: {exc}") from exc

    # Defensive no-fabrication guarantee: strip any matched_item_id the LLM
    # invented that doesn't actually exist in the resume, rather than trusting
    # the prompt instruction alone.
    valid_ids = {item.id for item in resume.all_items()}
    dropped = [i for i in result.matched_item_ids if i not in valid_ids]
    if dropped:
        logger.warning("Dropping hallucinated matched_item_ids not in resume: %s", dropped)
        result.matched_item_ids = [i for i in result.matched_item_ids if i in valid_ids]

    return result
