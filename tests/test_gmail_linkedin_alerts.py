import base64
from unittest.mock import MagicMock, patch

from app.sources.gmail_linkedin_alerts import GmailLinkedInAlertsAdapter, _get_credentials, _jobs_from_html


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("utf-8")


SAMPLE_HTML = """
<html><body>
<table>
<tr><td>
  <a href="https://www.linkedin.com/jobs/view/1234?trk=x">ML Engineer Intern at OpenAI</a>
  <div>San Francisco, CA</div>
</td></tr>
<tr><td>
  <a href="https://www.linkedin.com/jobs/view/5678?trk=x">Backend Engineer at Stripe</a>
  <div>Remote</div>
</td></tr>
</table>
</body></html>
"""


def test_jobs_from_html_extracts_multiple_jobs():
    postings = _jobs_from_html("msg1", SAMPLE_HTML)
    assert len(postings) == 2
    assert postings[0].source_name == "gmail_linkedin"
    assert postings[0].external_id == "msg1:0"
    assert "ML Engineer Intern" in postings[0].raw_text
    assert postings[1].external_id == "msg1:1"
    assert "Backend Engineer" in postings[1].raw_text


def test_jobs_from_html_dedupes_repeated_links():
    html = SAMPLE_HTML + '<a href="https://www.linkedin.com/jobs/view/1234?trk=y">dup</a>'
    postings = _jobs_from_html("msg1", html)
    assert len(postings) == 2


def test_fetch_uses_service_and_parses_messages():
    fake_service = MagicMock()
    fake_service.users.return_value.messages.return_value.list.return_value.execute.return_value = {
        "messages": [{"id": "m1"}]
    }
    fake_service.users.return_value.messages.return_value.get.return_value.execute.return_value = {
        "payload": {
            "mimeType": "text/html",
            "body": {"data": _b64(SAMPLE_HTML)},
        }
    }

    with patch("app.sources.gmail_linkedin_alerts._get_service", return_value=fake_service):
        postings = GmailLinkedInAlertsAdapter().fetch()

    assert len(postings) == 2


def test_dedupe_key():
    from app.sources.base import RawJobPosting

    adapter = GmailLinkedInAlertsAdapter()
    posting = RawJobPosting(source_name="gmail_linkedin", external_id="m1:0", raw_text="x")
    assert adapter.dedupe_key(posting) == "gmail_linkedin:m1:0"


def test_get_credentials_falls_back_to_interactive_flow_when_refresh_token_is_dead(tmp_path):
    # Regression test (2026-09-23): a RefreshError from creds.refresh()
    # (e.g. "invalid_grant" — the refresh token itself expired/was
    # revoked, not just the access token) used to propagate uncaught,
    # crashing every run instead of falling through to re-authorization.
    from google.auth.exceptions import RefreshError

    token_path = tmp_path / "token.json"
    token_path.write_text("{}")

    stale_creds = MagicMock(valid=False, expired=True, refresh_token="r1")
    stale_creds.refresh.side_effect = RefreshError("invalid_grant")
    fresh_creds = MagicMock()
    fresh_creds.to_json.return_value = "{}"

    with (
        patch("app.sources.gmail_linkedin_alerts.settings") as mock_settings,
        patch("google.oauth2.credentials.Credentials.from_authorized_user_file", return_value=stale_creds),
        patch("google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file") as mock_flow_ctor,
    ):
        mock_settings.gmail_token_path = str(token_path)
        mock_settings.gmail_credentials_path = "unused.json"
        mock_flow_ctor.return_value.run_local_server.return_value = fresh_creds

        result = _get_credentials()

    stale_creds.refresh.assert_called_once()
    mock_flow_ctor.return_value.run_local_server.assert_called_once()
    assert result is fresh_creds
