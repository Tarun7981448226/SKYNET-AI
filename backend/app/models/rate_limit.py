from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PublicAskRateLimit(Base):
    """Fixed-window per-IP request counter for the public landing page's
    restricted Q&A endpoint (frontend/app/api/public/ask/route.ts) — that
    endpoint is reachable by anyone on the internet with no login, unlike
    the rest of the dashboard's API, so it needs its own abuse guard rather
    than relying on requireSession. Written and read entirely by the
    Next.js app; exists here only so Alembic stays the single schema
    source of truth for the whole project (see webauthn_credentials for
    the same reasoning)."""

    __tablename__ = "public_ask_rate_limit"

    ip: Mapped[str] = mapped_column(String, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
