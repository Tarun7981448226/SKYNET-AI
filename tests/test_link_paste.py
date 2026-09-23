from unittest.mock import patch

import pytest
import requests

from app.sources.link_paste import LinkFetchError, fetch_job_page_text


class FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


def test_strips_tags_scripts_and_styles():
    html = """
    <html><head><style>.foo{color:red}</style></head>
    <body>
      <script>console.log('nope')</script>
      <h1>Senior-sounding-but-really-entry ML Engineer</h1>
      <p>We are looking for someone with Python and PyTorch experience.</p>
    </body></html>
    """ + ("padding " * 20)

    with patch("app.sources.link_paste.requests.get", return_value=FakeResponse(200, html)):
        text = fetch_job_page_text("https://example.com/jobs/123")

    assert "console.log" not in text
    assert "color:red" not in text
    assert "<h1>" not in text
    assert "ML Engineer" in text
    assert "Python and PyTorch" in text


def test_non_200_raises():
    with patch("app.sources.link_paste.requests.get", return_value=FakeResponse(404, "not found")):
        with pytest.raises(LinkFetchError):
            fetch_job_page_text("https://example.com/gone")


def test_network_failure_raises():
    with patch("app.sources.link_paste.requests.get", side_effect=requests.ConnectionError("no route")):
        with pytest.raises(LinkFetchError):
            fetch_job_page_text("https://example.com/unreachable")


def test_js_only_page_with_no_text_raises():
    html = "<html><body><div id='app'></div><script>renderApp()</script></body></html>"
    with patch("app.sources.link_paste.requests.get", return_value=FakeResponse(200, html)):
        with pytest.raises(LinkFetchError):
            fetch_job_page_text("https://example.com/spa")
