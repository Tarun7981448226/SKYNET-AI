from unittest.mock import patch

from app.alerts import _alert_chat_id, send_error_alert, send_gmail_failure_alert, send_sheets_failure_alert, send_success_alert


def test_send_error_alert_includes_type_and_message():
    with patch("app.alerts._send") as send_mock:
        send_error_alert("boom", error_type="ingest")

    text = send_mock.call_args[0][0]
    assert "[INGEST]" in text
    assert "boom" in text


def test_send_success_alert_has_checkmark_prefix():
    with patch("app.alerts._send") as send_mock:
        send_success_alert("12 jobs found")

    assert "12 jobs found" in send_mock.call_args[0][0]


def test_send_gmail_failure_alert_message():
    with patch("app.alerts._send") as send_mock:
        send_gmail_failure_alert()

    assert "GMAIL" in send_mock.call_args[0][0]


def test_send_sheets_failure_alert_includes_company_and_role():
    with patch("app.alerts._send") as send_mock:
        send_sheets_failure_alert("Acme", "ML Engineer")

    text = send_mock.call_args[0][0]
    assert "Acme" in text
    assert "ML Engineer" in text


def test_alert_chat_id_prefers_alert_chat_id(monkeypatch):
    monkeypatch.setattr("app.alerts.settings.telegram_alert_chat_id", "alert123")
    monkeypatch.setattr("app.alerts.settings.telegram_owner_chat_id", "owner456")
    assert _alert_chat_id() == "alert123"


def test_alert_chat_id_falls_back_to_owner(monkeypatch):
    monkeypatch.setattr("app.alerts.settings.telegram_alert_chat_id", None)
    monkeypatch.setattr("app.alerts.settings.telegram_owner_chat_id", "owner456")
    assert _alert_chat_id() == "owner456"


def test_send_without_token_does_not_raise(monkeypatch):
    monkeypatch.setattr("app.alerts.settings.telegram_bot_token", None)
    send_error_alert("should not raise")  # must not raise even though unconfigured
