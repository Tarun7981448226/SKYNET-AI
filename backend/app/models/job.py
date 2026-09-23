from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index(
            "uq_job_apply_url",
            "apply_url",
            unique=True,
            postgresql_where=text("apply_url IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raw_post_id: Mapped[int | None] = mapped_column(ForeignKey("raw_posts.id"), nullable=True)
    company: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    skills: Mapped[list | None] = mapped_column(JSON, nullable=True)
    keywords: Mapped[list | None] = mapped_column(JSON, nullable=True)
    visa_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ai_ml / swe / data_science / other / null (unclear) — set by the JD
    # parser, drives which domain resume (data/resume_<domain>.md) tailoring
    # uses; data_science/other/null have no prepared resume yet and get
    # flagged instead of tailored. See run_tailor()'s _DOMAIN_RESUME_PATHS.
    domain: Mapped[str | None] = mapped_column(String, nullable=True)
    # null / "applied" / "rejected" — set from the Mark V dashboard. Deliberately
    # separate from `status` above, which drives the pipeline's own processing
    # state machine (new/scored/tailored/flagged_no_resume); overloading that
    # with a user-facing decision would break run_tailor()'s own queries.
    user_decision: Mapped[str | None] = mapped_column(String, nullable=True)
    posted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    apply_url: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    content_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
