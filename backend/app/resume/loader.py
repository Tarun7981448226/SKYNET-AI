import re
from pathlib import Path

import yaml

from app.resume.schema import Contact, ResumeItem, ResumeProfile

_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
_ITEM_BLOCK_RE = re.compile(r"```item\n(.*?)\n```", re.DOTALL)

_SECTION_TO_FIELD = {
    "summary": "summary",
    "education": "education",
    "experience": "experience",
    "research": "research",
    "projects": "projects",
    "skills": "skills",
    "certifications": "certifications",
    "achievements": "achievements",
    "publications": "publications",
}


class ResumeParseError(Exception):
    pass


def _split_sections(text: str) -> dict[str, str]:
    """Splits the file (after the top-level '# Resume Profile' heading) into
    {heading_name_lower: body_text} for each '## Heading' block."""
    matches = list(_SECTION_RE.finditer(text))
    sections: dict[str, str] = {}
    for i, match in enumerate(matches):
        name = match.group(1).strip().lower()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[name] = text[start:end]
    return sections


def _parse_contact(body: str) -> Contact:
    fields: dict[str, str] = {}
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("-"):
            continue
        key, _, value = line[1:].partition(":")
        fields[key.strip().lower()] = value.strip()
    if "name" not in fields or "email" not in fields:
        raise ResumeParseError("Contact section must have at least name and email")
    links = [link.strip() for link in fields.get("links", "").split(",") if link.strip()]
    return Contact(
        name=fields["name"],
        email=fields["email"],
        phone=fields.get("phone"),
        location=fields.get("location"),
        links=links,
    )


def _parse_items(body: str, section_name: str) -> list[ResumeItem]:
    items = []
    for block in _ITEM_BLOCK_RE.findall(body):
        try:
            data = yaml.safe_load(block)
        except yaml.YAMLError as exc:
            raise ResumeParseError(f"Invalid YAML in a '{section_name}' item block: {exc}") from exc
        if not isinstance(data, dict) or "id" not in data:
            raise ResumeParseError(f"Item block in '{section_name}' is missing required 'id' field")
        data["section"] = section_name
        items.append(ResumeItem(**data))
    return items


def load_resume(path: str | Path) -> ResumeProfile:
    text = Path(path).read_text()
    sections = _split_sections(text)

    if "contact" not in sections:
        raise ResumeParseError("resume.md is missing a '## Contact' section")
    contact = _parse_contact(sections["contact"])

    parsed: dict[str, list[ResumeItem]] = {}
    for heading, field in _SECTION_TO_FIELD.items():
        parsed[field] = _parse_items(sections.get(heading, ""), heading) if heading in sections else []

    profile = ResumeProfile(contact=contact, **parsed)

    ids = [item.id for item in profile.all_items()]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise ResumeParseError(f"Duplicate resume item ids: {sorted(duplicates)}")

    return profile
