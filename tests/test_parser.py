import pytest

from app.llm.base import LLMProvider
from app.parsing.parser import ParseError, parse_raw_post


class FakeLLM(LLMProvider):
    def __init__(self, response: str):
        self.response = response
        self.calls = 0

    def complete(self, prompt: str) -> str:
        self.calls += 1
        return self.response


def test_parse_valid_job():
    response = """{"is_job": true, "job": {"company": "OpenAI", "role": "ML Engineer Intern", "type": "internship", "location": "San Francisco, CA", "skills": ["python", "pytorch"], "keywords": ["python", "pytorch", "ml"], "visa_notes": null, "deadline": null, "apply_url": null}, "reason": null}"""
    result = parse_raw_post("some job text", url="https://x/1", llm=FakeLLM(response))
    assert result.is_job is True
    assert result.job.company == "OpenAI"
    assert result.job.apply_url == "https://x/1"  # fallback from raw_post.url


def test_parse_non_job_is_flagged_not_error():
    response = '{"is_job": false, "job": null, "reason": "This is a newsletter, not a job posting"}'
    result = parse_raw_post("some newsletter text", llm=FakeLLM(response))
    assert result.is_job is False
    assert result.job is None


def test_parse_strips_markdown_fences():
    response = '```json\n{"is_job": false, "job": null, "reason": "spam"}\n```'
    result = parse_raw_post("spam text", llm=FakeLLM(response))
    assert result.is_job is False


def test_parse_invalid_json_raises_parse_error():
    with pytest.raises(ParseError):
        parse_raw_post("some text", llm=FakeLLM("not json at all"))


def test_parse_schema_violation_raises_parse_error():
    response = '{"is_job": true, "job": {"role": "missing company field"}}'
    with pytest.raises(ParseError):
        parse_raw_post("some text", llm=FakeLLM(response))


def test_parse_keeps_llm_apply_url_over_fallback():
    response = """{"is_job": true, "job": {"company": "Stripe", "role": "SWE", "type": null, "location": null, "skills": [], "keywords": [], "visa_notes": null, "deadline": null, "apply_url": "https://stripe.com/jobs/1"}, "reason": null}"""
    result = parse_raw_post("text", url="https://fallback/x", llm=FakeLLM(response))
    assert result.job.apply_url == "https://stripe.com/jobs/1"
