from unittest.mock import MagicMock, patch

import pytest

from app.rendering.drive_upload import DriveUploadError, upload_to_drive


def test_upload_without_folder_id_raises(monkeypatch):
    monkeypatch.setattr("app.rendering.drive_upload.settings.google_drive_folder_id", None)
    with pytest.raises(DriveUploadError):
        upload_to_drive("resumes/resume1.pdf")


def test_upload_returns_web_view_link(monkeypatch, tmp_path):
    monkeypatch.setattr("app.rendering.drive_upload.settings.google_drive_folder_id", "folder123")
    pdf = tmp_path / "resume1.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    fake_service = MagicMock()
    fake_service.files().create().execute.return_value = {"id": "file123"}
    fake_service.files().get().execute.return_value = {"webViewLink": "https://drive.google.com/file/d/file123/view"}

    with patch("app.rendering.drive_upload._get_service", return_value=fake_service):
        link = upload_to_drive(str(pdf))

    assert link == "https://drive.google.com/file/d/file123/view"
    fake_service.permissions().create.assert_called()
