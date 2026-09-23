import json
import logging
import re

from app.llm.base import LLMProvider
from app.llm.factory import get_llm_provider
from app.llm.json_utils import strip_code_fences
from app.models.job import Job
from app.resume.schema import ResumeItem, ResumeProfile
from app.scoring.schema import FitScoreResult
from app.tailoring.schema import TailoredItem, TailoredResumeContent

logger = logging.getLogger(__name__)

# Per-section cap so a tailored resume stays realistically one-page-sized —
# rendering doesn't do text-fit trimming, so tailoring picks a sane subset.
_SECTION_LIMITS = {"projects": 3, "certifications": 4}

_DIGIT_RE = re.compile(r"\d+")

# See ats-resume + no-fabrication skills: reword only for length/flow/keyword
# mirroring of a JD term that already truthfully applies — never add a new
# fact, tool, metric, or upgraded claim.
REWORD_PROMPT_TEMPLATE = """You are tailoring resume bullets for a specific job application. For each resume item below, you may reword its bullets to better emphasize relevance to the job — but you must NEVER add a skill, tool, employer, metric, or claim that isn't already in the original bullet. You may only: tighten phrasing, reorder clauses, or substitute a synonym with the job's exact terminology when that terminology already truthfully describes what the bullet says. Keep the same number of bullets per item, in the same order, with the same meaning.

Job: {role} at {company}. Job keywords: {keywords}

Resume items (id | original bullets):
{items}

Respond with ONLY a single JSON object mapping each item id to its list of (possibly reworded) bullets, no markdown fences, no commentary, matching exactly this shape:
{{"item-id-1": ["bullet 1", "bullet 2"], "item-id-2": ["bullet 1"]}}
"""


class TailorError(Exception):
    pass


def _matched_first(items: list[ResumeItem], matched_ids: set[str]) -> list[ResumeItem]:
    return sorted(items, key=lambda item: item.id not in matched_ids)


def _select(section: str, items: list[ResumeItem], matched_ids: set[str]) -> list[ResumeItem]:
    ranked = _matched_first(items, matched_ids)
    limit = _SECTION_LIMITS.get(section)
    return ranked[:limit] if limit else ranked


def _has_unbacked_numbers(original: str, reworded: str) -> bool:
    """Safety net beyond the prompt: reject a reword that introduces a digit
    sequence (a metric/date/count) not present in the original bullet."""
    return not set(_DIGIT_RE.findall(reworded)) <= set(_DIGIT_RE.findall(original))


def _reword_bullets(
    selected: dict[str, list[ResumeItem]], job: Job, llm: LLMProvider
) -> dict[str, list[str]]:
    all_items = [item for items in selected.values() for item in items]
    if not all_items:
        return {}

    items_text = "\n".join(
        f"- {item.id}: " + " | ".join(item.bullets) for item in all_items if item.bullets
    )
    if not items_text:
        return {}

    prompt = REWORD_PROMPT_TEMPLATE.format(
        role=job.role, company=job.company, keywords=job.keywords or [], items=items_text
    )

    try:
        response_text = llm.complete(prompt)
        data = json.loads(strip_code_fences(response_text))
    except Exception as exc:
        logger.warning("Reword LLM call failed, falling back to original bullets: %s", exc)
        return {}

    reworded: dict[str, list[str]] = {}
    for item in all_items:
        original = item.bullets
        candidate = data.get(item.id)
        if not isinstance(candidate, list) or len(candidate) != len(original):
            continue  # fall back to original bullets for this item
        if any(not isinstance(b, str) for b in candidate):
            continue
        if any(_has_unbacked_numbers(orig, new) for orig, new in zip(original, candidate)):
            logger.warning("Rejecting reworded bullets for %s: introduced an unbacked number", item.id)
            continue
        reworded[item.id] = candidate
    return reworded


def tailor_resume(
    resume: ResumeProfile, job: Job, score_result: FitScoreResult, llm: LLMProvider | None = None
) -> TailoredResumeContent:
    provider = llm or get_llm_provider()
    matched_ids = set(score_result.matched_item_ids)

    selected: dict[str, list[ResumeItem]] = {
        "summary": resume.summary,
        "education": resume.education,
        "experience": _select("experience", resume.experience, matched_ids),
        "projects": _select("projects", resume.projects, matched_ids),
        "skills": _matched_first(resume.skills, matched_ids),
        "certifications": _select("certifications", resume.certifications, matched_ids),
        "achievements": resume.achievements,
        "publications": resume.publications,
    }

    reworded_bullets = _reword_bullets(selected, job, provider)

    def to_tailored(items: list[ResumeItem]) -> list[TailoredItem]:
        return [
            TailoredItem(
                id=item.id,
                section=item.section,
                title=item.title,
                dates=item.dates,
                bullets=reworded_bullets.get(item.id, item.bullets),
            )
            for item in items
        ]

    return TailoredResumeContent(
        job_id=job.id,
        contact=resume.contact,
        summary=to_tailored(selected["summary"]),
        education=to_tailored(selected["education"]),
        experience=to_tailored(selected["experience"]),
        projects=to_tailored(selected["projects"]),
        skills=to_tailored(selected["skills"]),
        certifications=to_tailored(selected["certifications"]),
        achievements=to_tailored(selected["achievements"]),
        publications=to_tailored(selected["publications"]),
    )
