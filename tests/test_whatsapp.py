from unittest.mock import patch

import pytest

from app.whatsapp import WhatsAppError, send_resume_pdf


class FakeResponse:
    def __init__(self, ok: bool, json_data=None, status_code: int = 200, text: str = ""):
        self.ok = ok
        self.status_code = status_code
        self.text = text
        self._json_data = json_data or {}

    def json(self):
        return self._json_data


def _configure(monkeypatch):
    monkeypatch.setattr("app.whatsapp.settings.whatsapp_access_token", "fake-token")
    monkeypatch.setattr("app.whatsapp.settings.whatsapp_phone_number_id", "12345")
    monkeypatch.setattr("app.whatsapp.settings.whatsapp_recipient_number", "+11234567890")


def test_raises_when_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr("app.whatsapp.settings.whatsapp_access_token", None)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    with pytest.raises(WhatsAppError):
        send_resume_pdf(str(pdf), "caption")


def test_uploads_media_then_sends_document(monkeypatch, tmp_path):
    _configure(monkeypatch)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if url.endswith("/media"):
            return FakeResponse(True, {"id": "media-abc"})
        return FakeResponse(True, {"messages": [{"id": "wamid.123"}]})

    with patch("app.whatsapp.requests.post", side_effect=fake_post):
        send_resume_pdf(str(pdf), "Acme — ML Engineer (fit score 88)")

    assert len(calls) == 2
    media_url, media_kwargs = calls[0]
    assert media_url.endswith("/12345/media")
    assert media_kwargs["files"]["file"][0] == "resume.pdf"

    send_url, send_kwargs = calls[1]
    assert send_url.endswith("/12345/messages")
    payload = send_kwargs["json"]
    assert payload["to"] == "+11234567890"
    assert payload["type"] == "document"
    assert payload["document"]["id"] == "media-abc"
    assert payload["document"]["caption"] == "Acme — ML Engineer (fit score 88)"


def test_media_upload_failure_raises(monkeypatch, tmp_path):
    _configure(monkeypatch)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    with patch("app.whatsapp.requests.post", return_value=FakeResponse(False, status_code=401, text="bad token")):
        with pytest.raises(WhatsAppError):
            send_resume_pdf(str(pdf), "caption")


def test_send_failure_after_successful_upload_raises(monkeypatch, tmp_path):
    _configure(monkeypatch)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    def fake_post(url, **kwargs):
        if url.endswith("/media"):
            return FakeResponse(True, {"id": "media-abc"})
        return FakeResponse(False, status_code=500, text="server error")

    with patch("app.whatsapp.requests.post", side_effect=fake_post):
        with pytest.raises(WhatsAppError):
            send_resume_pdf(str(pdf), "caption")
