"""Uploads a generated resume file to a Google Drive folder and returns a
shareable link, so the Sheet's Tailored Resume column points to something
that still exists after the GitHub Actions runner that generated it is gone
(Mark IV's serverless pipeline has no persistent disk between runs).

Uploads via OAuth as Tarun himself, not the Sheets service account: the
Drive API refuses files.create() for service accounts on a personal
(non-Workspace) Google account ("Service Accounts do not have storage
quota") — sharing the destination folder with the service account cannot
fix that, it's a hard rule on the account type. Reuses the same OAuth
client as gmail_linkedin_alerts.py (gmail_credentials_path) since it's
already an installed-app client on the same GCP project — just a separate
token file/scope, not a new Google Cloud credential. GOOGLE_DRIVE_FOLDER_ID
must be a folder in Tarun's own Drive (no sharing step needed — it's his
own account uploading)."""

import re
from pathlib import Path

from app.config import settings

_SCOPES = ["https://www.googleapis.com/auth/drive"]

_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class DriveUploadError(Exception):
    pass


def _get_credentials():
    import logging

    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    token_path = Path(settings.google_drive_token_path)
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), _SCOPES)
    if not creds or not creds.valid:
        refreshed = False
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                refreshed = True
            except RefreshError:
                # Same failure mode as gmail_linkedin_alerts.py's identical
                # guard (see there) — the refresh token itself expired/was
                # revoked, not just the access token. Falls through to the
                # interactive flow instead of crashing uncaught.
                logging.getLogger(__name__).warning(
                    "drive token refresh failed (refresh token expired/revoked) — re-authorizing"
                )
        if not refreshed:
            flow = InstalledAppFlow.from_client_secrets_file(settings.gmail_credentials_path, _SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json())
    return creds


def _get_service():
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=_get_credentials())


def upload_to_drive(local_path: str) -> str:
    """Uploads local_path into GOOGLE_DRIVE_FOLDER_ID and returns a
    shareable webViewLink. Raises DriveUploadError if not configured or the
    upload fails."""
    if not settings.google_drive_folder_id:
        raise DriveUploadError("GOOGLE_DRIVE_FOLDER_ID is not set in .env")

    from googleapiclient.http import MediaFileUpload

    path = Path(local_path)
    service = _get_service()
    file_metadata = {"name": path.name, "parents": [settings.google_drive_folder_id]}
    media = MediaFileUpload(str(path), mimetype=_MIME_TYPES.get(path.suffix, "application/octet-stream"))
    uploaded = service.files().create(body=file_metadata, media_body=media, fields="id").execute()

    file_id = uploaded["id"]
    # Anyone with the link can view — the point is Tarun can open it from
    # the Sheet on any device without a separate share step per file.
    service.permissions().create(fileId=file_id, body={"role": "reader", "type": "anyone"}).execute()

    result = service.files().get(fileId=file_id, fields="webViewLink").execute()
    return result["webViewLink"]


def trash_drive_file(drive_link_or_id: str) -> None:
    """Moves a file to Drive's trash (recoverable for ~30 days there —
    deliberately not a permanent delete via files().delete(), since this
    gets called automatically when a job is rejected and a wrong reject
    click shouldn't be unrecoverable). Accepts either a raw file id or a
    webViewLink (https://drive.google.com/file/d/<id>/view...) since
    that's what's actually stored in tailored_resumes.drive_link."""
    match = re.search(r"/d/([^/]+)", drive_link_or_id)
    file_id = match.group(1) if match else drive_link_or_id
    service = _get_service()
    service.files().update(fileId=file_id, body={"trashed": True}).execute()
