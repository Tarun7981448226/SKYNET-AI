from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.telegram_delivery import TelegramDeliveryError, send_resume_document


def _configure(monkeypatch):
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_bot_token", "fake-token")
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_owner_chat_id", "owner123")
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_alert_chat_id", None)


class FakeBot:
    """Mimics telegram.Bot's async-context-manager + send_document shape
    without touching the real network."""

    def __init__(self, token):
        self.token = token
        self.send_document = AsyncMock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def test_raises_when_no_bot_token(monkeypatch, tmp_path):
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_bot_token", None)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    with pytest.raises(TelegramDeliveryError):
        send_resume_document(str(pdf), "caption")


def test_raises_when_no_chat_id(monkeypatch, tmp_path):
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_bot_token", "fake-token")
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_owner_chat_id", None)
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_alert_chat_id", None)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    with pytest.raises(TelegramDeliveryError):
        send_resume_document(str(pdf), "caption")


def test_falls_back_to_alert_chat_id_if_owner_unset(monkeypatch, tmp_path):
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_bot_token", "fake-token")
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_owner_chat_id", None)
    monkeypatch.setattr("app.telegram_delivery.settings.telegram_alert_chat_id", "alert456")
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    fake_bot = FakeBot("fake-token")
    with patch("telegram.Bot", return_value=fake_bot):
        send_resume_document(str(pdf), "caption")

    assert fake_bot.send_document.call_args.kwargs["chat_id"] == "alert456"


def test_raises_when_file_missing(monkeypatch):
    _configure(monkeypatch)
    with pytest.raises(TelegramDeliveryError):
        send_resume_document("/no/such/file.pdf", "caption")


def test_sends_document_with_correct_args(monkeypatch, tmp_path):
    _configure(monkeypatch)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    fake_bot = FakeBot("fake-token")
    with patch("telegram.Bot", return_value=fake_bot) as bot_ctor:
        send_resume_document(str(pdf), "Acme — ML Engineer (fit score 88)")

    bot_ctor.assert_called_once_with(token="fake-token")
    kwargs = fake_bot.send_document.call_args.kwargs
    assert kwargs["chat_id"] == "owner123"
    assert kwargs["filename"] == "resume.pdf"
    assert kwargs["caption"] == "Acme — ML Engineer (fit score 88)"
    assert str(kwargs["document"]) == str(pdf)


def test_telegram_error_becomes_delivery_error(monkeypatch, tmp_path):
    _configure(monkeypatch)
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    from telegram.error import TelegramError

    fake_bot = MagicMock()
    fake_bot.__aenter__ = AsyncMock(side_effect=TelegramError("bad token"))
    fake_bot.__aexit__ = AsyncMock(return_value=False)

    with patch("telegram.Bot", return_value=fake_bot):
        with pytest.raises(TelegramDeliveryError):
            send_resume_document(str(pdf), "caption")
