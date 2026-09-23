import json

import pytest

from app.llm.base import LLMProvider
from app.models.job import Job
from app.resume.loader import load_resume
from app.scoring.schema import FitScoreResult
from app.tailoring.tailor import tailor_resume

RESUME_FIXTURE = """\
# Resume Profile

## Contact
- name: Jane Doe
- email: jane@example.com

## Summary
```item
id: summary-main
tags: [ml]
keywords: [python]
bullets:
  - MSCS student with applied ML experience.
```

## Education
```item
id: edu-usc
tags: [ml]
dates: 2024-08 – 2026-05
keywords: [computer science]
bullets:
  - M.S. Computer Science, USC.
```

## Experience
```item
id: exp-one
tags: [ml]
dates: 2024
keywords: [python]
bullets:
  - Built a data pipeline processing 10k records/day.
```

## Projects
```item
id: project-a
tags: [ml]
dates: 2024
keywords: [pytorch]
bullets:
  - Trained a PyTorch model achieving 95% accuracy.
```
```item
id: project-b
tags: [backend]
dates: 2024
keywords: [react]
bullets:
  - Built a React dashboard.
```
```item
id: project-c
tags: [ml]
dates: 2023
keywords: [nlp]
bullets:
  - Built an NLP pipeline.
```
```item
id: project-d
tags: [systems]
dates: 2023
keywords: [tcp]
bullets:
  - Implemented a transport protocol.
```

## Skills
```item
id: skills-ml
tags: [ml]
keywords: [pytorch]
bullets:
  - "ML: PyTorch"
```
"""


class FakeLLM(LLMProvider):
    def __init__(self, response: str):
        self.response = response
        self.prompts: list[str] = []

    def complete(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.response


class RaisingLLM(LLMProvider):
    def complete(self, prompt: str) -> str:
        raise RuntimeError("LLM unavailable")


@pytest.fixture
def resume(tmp_path):
    path = tmp_path / "resume.md"
    path.write_text(RESUME_FIXTURE)
    return load_resume(path)


def _job() -> Job:
    return Job(
        id=1,
        company="Acme",
        role="ML Engineer",
        skills=["pytorch"],
        keywords=["pytorch"],
        content_hash="h",
        source="test",
    )


def _score(matched: list[str]) -> FitScoreResult:
    return FitScoreResult(score=80, matched_item_ids=matched, gaps=[], rationale="ok")


def test_tailor_promotes_matched_projects_first(resume):
    score = _score(["project-c"])
    llm = FakeLLM("{}")  # no reword — falls back to originals
    result = tailor_resume(resume, _job(), score, llm=llm)
    # project-c matched -> should be first; projects capped at 3 of the 4 defined
    assert len(result.projects) == 3
    assert result.projects[0].id == "project-c"


def test_tailor_falls_back_to_original_bullets_on_llm_failure(resume):
    score = _score(["project-a"])
    result = tailor_resume(resume, _job(), score, llm=RaisingLLM())
    project_a = next(p for p in result.projects if p.id == "project-a")
    assert project_a.bullets == ["Trained a PyTorch model achieving 95% accuracy."]


def test_tailor_uses_valid_reword(resume):
    reword_response = json.dumps(
        {
            "summary-main": ["MSCS student with applied ML experience."],
            "edu-usc": ["M.S. Computer Science, USC."],
            "exp-one": ["Built a data pipeline processing 10k records/day using Python."],
            "project-a": ["Trained a PyTorch model achieving 95% accuracy on the validation set."],
            "project-c": ["Built an NLP pipeline."],
            "project-d": ["Implemented a transport protocol."],
            "skills-ml": ["ML: PyTorch"],
        }
    )
    score = _score(["project-a"])
    result = tailor_resume(resume, _job(), score, llm=FakeLLM(reword_response))
    project_a = next(p for p in result.projects if p.id == "project-a")
    assert "validation set" in project_a.bullets[0]


def test_tailor_rejects_reword_with_unbacked_number(resume):
    # Original has no numbers; reworded invents "50%" — must fall back.
    reword_response = json.dumps({"project-b": ["Built a React dashboard used by 50% of the team."]})
    score = _score(["project-b"])
    result = tailor_resume(resume, _job(), score, llm=FakeLLM(reword_response))
    project_b = next(p for p in result.projects if p.id == "project-b")
    assert project_b.bullets == ["Built a React dashboard."]


def test_tailor_no_invented_bullets_anywhere(resume):
    score = _score(["project-a", "skills-ml"])
    result = tailor_resume(resume, _job(), score, llm=RaisingLLM())
    original_bullets = {b for item in resume.all_items() for b in item.bullets}
    for _, items in result.sections():
        for item in items:
            for bullet in item.bullets:
                assert bullet in original_bullets


def test_tailor_always_includes_summary_and_education(resume):
    score = _score([])
    result = tailor_resume(resume, _job(), score, llm=RaisingLLM())
    assert len(result.summary) == 1
    assert len(result.education) == 1
