from datetime import date
from unittest.mock import patch

from app.sources.greenhouse_lever import GreenhouseAdapter, LeverAdapter


class FakeResponse:
    def __init__(self, status_code: int, json_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def json(self):
        return self._json_data


def test_greenhouse_adapter_skips_404_and_parses_jobs():
    def fake_get(url, timeout=15):
        if "openai" in url:
            return FakeResponse(
                200,
                {
                    "jobs": [
                        {
                            "id": 1,
                            "title": "ML Engineer Intern",
                            "location": {"name": "San Francisco, CA"},
                            "content": "<p>Great role</p>",
                            "absolute_url": "https://boards.greenhouse.io/openai/jobs/1",
                            "updated_at": "2026-09-01T12:00:00-05:00",
                            "application_deadline": "2026-10-15T00:00:00-05:00",
                        }
                    ]
                },
            )
        return FakeResponse(404)

    with patch("app.sources.greenhouse_lever.requests.get", side_effect=fake_get), patch(
        "app.sources.greenhouse_lever._greenhouse_slugs", return_value=["openai", "nonexistent"]
    ):
        postings = GreenhouseAdapter().fetch()

    assert len(postings) == 1
    assert postings[0].source_name == "greenhouse:openai"
    assert postings[0].external_id == "1"
    assert "ML Engineer Intern" in postings[0].raw_text
    assert postings[0].url == "https://boards.greenhouse.io/openai/jobs/1"
    assert postings[0].posted_date == date(2026, 9, 1)
    assert postings[0].deadline == date(2026, 10, 15)


def test_greenhouse_adapter_missing_updated_at_leaves_posted_date_none():
    def fake_get(url, timeout=15):
        return FakeResponse(200, {"jobs": [{"id": 2, "title": "SWE", "location": {}, "content": ""}]})

    with patch("app.sources.greenhouse_lever.requests.get", side_effect=fake_get), patch(
        "app.sources.greenhouse_lever._greenhouse_slugs", return_value=["openai"]
    ):
        postings = GreenhouseAdapter().fetch()

    assert postings[0].posted_date is None


def test_greenhouse_adapter_dedupe_key():
    adapter = GreenhouseAdapter()
    from app.sources.base import RawJobPosting

    posting = RawJobPosting(source_name="greenhouse:openai", external_id="1", raw_text="x")
    assert adapter.dedupe_key(posting) == "greenhouse:openai:1"


def test_lever_adapter_skips_404_and_parses_postings():
    def fake_get(url, timeout=15):
        if "scaleai" in url:
            return FakeResponse(
                200,
                [
                    {
                        "id": "abc123",
                        "text": "Backend Engineer",
                        "categories": {"location": "Remote"},
                        "descriptionPlain": "Build things",
                        "hostedUrl": "https://jobs.lever.co/scaleai/abc123",
                        "createdAt": 1798070400000,  # 2026-12-24T00:00:00Z
                    }
                ],
            )
        return FakeResponse(404)

    with patch("app.sources.greenhouse_lever.requests.get", side_effect=fake_get), patch(
        "app.sources.greenhouse_lever._lever_slugs", return_value=["scaleai", "nonexistent"]
    ):
        postings = LeverAdapter().fetch()

    assert len(postings) == 1
    assert postings[0].source_name == "lever:scaleai"
    assert postings[0].external_id == "abc123"
    assert postings[0].url == "https://jobs.lever.co/scaleai/abc123"
    assert postings[0].posted_date is not None


def test_lever_adapter_handles_request_error():
    import requests

    def fake_get(url, timeout=15):
        raise requests.RequestException("boom")

    with patch("app.sources.greenhouse_lever.requests.get", side_effect=fake_get), patch(
        "app.sources.greenhouse_lever._lever_slugs", return_value=["scaleai"]
    ):
        postings = LeverAdapter().fetch()

    assert postings == []


def test_greenhouse_adapter_skips_a_slug_that_hangs_past_the_wall_clock_limit():
    # Simulates a slow-but-steady trickle response: requests' own timeout=
    # only bounds gaps *between* bytes, so this would hang past that even
    # though it never technically violates the read timeout — the
    # SIGALRM-based _time_limit wrapper is what actually cuts it off.
    import time

    def fake_get(url, timeout=15):
        if "hangs" in url:
            time.sleep(2)
            return FakeResponse(200, {"jobs": []})
        return FakeResponse(200, {"jobs": [{"id": 9, "title": "Fine", "location": {}, "content": ""}]})

    with (
        patch("app.sources.greenhouse_lever.requests.get", side_effect=fake_get),
        patch("app.sources.greenhouse_lever._REQUEST_WALL_CLOCK_LIMIT_S", 1),
        patch("app.sources.greenhouse_lever._greenhouse_slugs", return_value=["hangs", "openai"]),
    ):
        postings = GreenhouseAdapter().fetch()

    # The hung slug is skipped, but the next one still gets processed —
    # exactly the bug this was fixed for (one hang used to block everything).
    assert len(postings) == 1
    assert postings[0].source_name == "greenhouse:openai"
