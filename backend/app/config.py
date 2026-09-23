from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env at the repo root regardless of the caller's cwd (alembic is
# typically invoked from backend/, the CLI/tests from the repo root).
_ROOT_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    """App config loaded from .env. See secrets-hygiene skill: read secrets
    only through this class, never by re-parsing .env elsewhere."""

    model_config = SettingsConfigDict(env_file=str(_ROOT_ENV_FILE), extra="ignore")

    database_url: str = "postgresql://skynet:skynet@localhost:5433/skynet"

    telegram_api_id: str | None = None
    telegram_api_hash: str | None = None
    telegram_session_name: str = "skynet"
    telegram_bot_token: str | None = None
    telegram_job_channels: str | None = None
    telegram_owner_chat_id: str | None = None
    telegram_alert_chat_id: str | None = None

    gmail_credentials_path: str | None = None
    gmail_token_path: str | None = None
    gmail_linkedin_label: str = "LinkedIn Job Alerts"
    gmail_lookback_days: int = 14

    google_sheets_id: str | None = None
    google_sheets_credentials_path: str = "credentials/sheets_key.json"
    google_drive_folder_id: str | None = None
    # Drive uploads use OAuth as Tarun himself (his own storage quota), not
    # the Sheets service account — Drive's API refuses files.create() for
    # service accounts on a personal (non-Workspace) Google account. Reuses
    # the same OAuth client as Gmail (gmail_credentials_path), just a
    # separate token file/scope. See drive_upload.py.
    google_drive_token_path: str = "credentials/drive_token.json"

    greenhouse_board_tokens: str | None = None
    lever_company_slugs: str | None = None

    llm_provider: str = "gemini"
    gemini_api_key: str | None = None
    gemini_rate_limit_rpm: int = 5
    groq_api_key: str | None = None
    anthropic_api_key: str | None = None

    # WhatsApp Cloud API (Meta) — sends the tailored PDF from an on-demand
    # pasted-link request (backend/app/whatsapp.py). A one-time Meta
    # developer app + test number setup, done by Tarun himself; see
    # README's "WhatsApp delivery setup" section.
    whatsapp_access_token: str | None = None
    whatsapp_phone_number_id: str | None = None
    whatsapp_recipient_number: str | None = None

    # Web Push (Mark VI) — the Next.js route that actually sends the
    # browser push notification (backend/app/push_notify.py just triggers
    # it over HTTP; the VAPID keys and subscription storage live entirely
    # on the frontend side, see frontend/lib/push/*.ts).
    push_notify_url: str | None = None
    push_notify_secret: str | None = None


settings = Settings()
