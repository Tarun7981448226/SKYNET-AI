from unittest.mock import patch

from app.push_notify import notify_resume_ready


def _configure(monkeypatch):
    monkeypatch.setattr("app.push_notify.settings.push_notify_url", "https://skynet.example/api/push/notify")
    monkeypatch.setattr("app.push_notify.settings.push_notify_secret", "fake-secret")


def test_noop_when_not_configured(monkeypatch):
    monkeypatch.setattr("app.push_notify.settings.push_notify_url", None)
    monkeypatch.setattr("app.push_notify.settings.push_notify_secret", None)
    with patch("app.push_notify.requests.post") as post_mock:
        notify_resume_ready("Acme", "ML Engineer", 88, "https://drive.example/resume")
    post_mock.assert_not_called()


def test_posts_title_body_and_secret_header(monkeypatch):
    _configure(monkeypatch)
    with patch("app.push_notify.requests.post") as post_mock:
        notify_resume_ready("Acme", "ML Engineer", 88, "https://drive.example/resume")

    post_mock.assert_called_once()
    url, kwargs = post_mock.call_args[0][0], post_mock.call_args[1]
    assert url == "https://skynet.example/api/push/notify"
    assert kwargs["headers"]["x-push-secret"] == "fake-secret"
    payload = kwargs["json"]
    assert payload["title"] == "New tailored resume ready"
    assert "ML Engineer" in payload["body"]
    assert "Acme" in payload["body"]
    assert "88" in payload["body"]
    assert payload["url"] == "https://drive.example/resume"


def test_falls_back_to_dashboard_url_when_no_drive_link(monkeypatch):
    _configure(monkeypatch)
    with patch("app.push_notify.requests.post") as post_mock:
        notify_resume_ready("Acme", "ML Engineer", 88, None)

    payload = post_mock.call_args[1]["json"]
    assert payload["url"] == "/dashboard"


def test_omits_score_from_body_when_none(monkeypatch):
    _configure(monkeypatch)
    with patch("app.push_notify.requests.post") as post_mock:
        notify_resume_ready("Acme", "ML Engineer", None, None)

    payload = post_mock.call_args[1]["json"]
    assert "fit score" not in payload["body"]


def test_never_raises_when_requests_post_fails(monkeypatch):
    _configure(monkeypatch)
    with patch("app.push_notify.requests.post", side_effect=Exception("network down")):
        notify_resume_ready("Acme", "ML Engineer", 88, None)  # must not raise
