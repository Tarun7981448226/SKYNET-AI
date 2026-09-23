import pytest

from app.llm.base import LLMProvider
from app.models.job import Job
from app.resume.loader import load_resume
from app.scoring.scorer import ScoreError, score_job

RESUME_FIXTURE = """\
# Resume Profile

## Contact
- name: Jane Doe
- email: jane@example.com

## Skills
```item
id: skills-ml
tags: [ml]
keywords: [pytorch, tensorflow, computer vision]
bullets:
  - "ML: PyTorch, TensorFlow, Computer Vision"
```

## Projects
```item
id: project-cv
tags: [ml]
dates: 2024
keywords: [opencv, pytorch]
bullets:
  - Built a computer vision pipeline with OpenCV and PyTorch.
```
"""


class FakeLLM(LLMProvider):
    def __init__(self, response: str):
        self.response = response

    def complete(self, prompt: str) -> str:
        return self.response


@pytest.fixture
def resume(tmp_path):
    path = tmp_path / "resume.md"
    path.write_text(RESUME_FIXTURE)
    return load_resume(path)


def _job(**overrides) -> Job:
    defaults = dict(
        company="Acme",
        role="ML Engineer Intern",
        type="internship",
        location="Remote",
        skills=["pytorch", "computer vision"],
        keywords=["pytorch", "computer vision"],
        visa_notes=None,
        content_hash="hash1",
        source="test",
    )
    defaults.update(overrides)
    return Job(**defaults)


def test_score_ml_heavy_job_matches_resume(resume):
    response = '{"score": 85, "matched_item_ids": ["skills-ml", "project-cv"], "gaps": [], "rationale": "Strong PyTorch/CV overlap.", "visa_flag": false}'
    result = score_job(_job(), resume, llm=FakeLLM(response))
    assert result.score == 85
    assert set(result.matched_item_ids) == {"skills-ml", "project-cv"}
    assert result.visa_flag is False


def test_score_unrelated_job_has_low_score_and_gaps(resume):
    job = _job(role="Civil Engineer", skills=["autocad", "structural analysis"], keywords=["autocad"])
    response = '{"score": 5, "matched_item_ids": [], "gaps": ["autocad", "structural analysis"], "rationale": "No overlap with resume.", "visa_flag": false}'
    result = score_job(job, resume, llm=FakeLLM(response))
    assert result.score == 5
    assert result.matched_item_ids == []
    assert "autocad" in result.gaps


def test_score_drops_hallucinated_matched_ids(resume):
    response = '{"score": 50, "matched_item_ids": ["skills-ml", "does-not-exist"], "gaps": [], "rationale": "Partial match.", "visa_flag": false}'
    result = score_job(_job(), resume, llm=FakeLLM(response))
    assert result.matched_item_ids == ["skills-ml"]


def test_score_visa_flag_true_for_citizenship_requirement(resume):
    job = _job(visa_notes="Must be a U.S. citizen; no sponsorship available.")
    response = '{"score": 60, "matched_item_ids": ["skills-ml"], "gaps": [], "rationale": "Skills match but citizenship required.", "visa_flag": true}'
    result = score_job(job, resume, llm=FakeLLM(response))
    assert result.visa_flag is True


def test_score_invalid_json_raises_score_error(resume):
    with pytest.raises(ScoreError):
        score_job(_job(), resume, llm=FakeLLM("not json"))


def test_score_out_of_range_raises_score_error(resume):
    response = '{"score": 150, "matched_item_ids": [], "gaps": [], "rationale": "x", "visa_flag": false}'
    with pytest.raises(ScoreError):
        score_job(_job(), resume, llm=FakeLLM(response))
