from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LinkResumeRequest(Base):
    """One row per pasted-link request from the dashboard's on-demand
    "paste a link" feature (frontend/app/api/dashboard/link-resume). Written
    by Next.js when the link is submitted (status="pending"), then updated
    by the Python side (backend/app/cli.py's run_link_resume, triggered via
    a GitHub Actions workflow_dispatch for an instant feel rather than
    waiting for the hourly cron) once the scrape/score/tailor/render/
    WhatsApp-send pipeline finishes. The dashboard polls this row's status
    to show progress instead of blocking on the synchronous request."""

    __tablename__ = "link_resume_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    url: Mapped[str] = mapped_column(String, nullable=False)
    # pending -> done | failed
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"), nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    drive_link: Mapped[str | None] = mapped_column(String, nullable=True)
    # "sent" / "failed: <reason>" / null if WhatsApp isn't configured yet —
    # deliberately doesn't fail the whole request on its own (see
    # run_link_resume): the resume is still real and reachable via
    # drive_link even if WhatsApp delivery itself didn't go through.
    whatsapp_status: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
