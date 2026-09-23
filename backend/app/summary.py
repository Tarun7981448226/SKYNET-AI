"""Morning summary for the dashboard (Mark V reads this file; for now it's
just written nightly and pushed to Telegram). No DB table of its own — it's
a derived snapshot over Job/FitScore/TailoredResume."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.alerts import send_success_alert
from app.db import SessionLocal
from app.models import FitScore, Job, TailoredResume

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
SUMMARY_PATH = STATIC_DIR / "summary.json"

_STRONG_THRESHOLD = 75
_MEDIUM_THRESHOLD = 50


def generate_morning_summary(lookback_hours: int = 24) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

    with SessionLocal() as session:
        jobs = session.query(Job).filter(Job.created_at >= cutoff).all()
        job_ids = [job.id for job in jobs]
        scores = {s.job_id: s for s in session.query(FitScore).filter(FitScore.job_id.in_(job_ids)).all()}
        tailored_job_ids = {
            t.job_id for t in session.query(TailoredResume).filter(TailoredResume.job_id.in_(job_ids)).all()
        }

        strong = medium = low = 0
        breakdown = []
        for job in jobs:
            score = scores.get(job.id)
            if score is not None:
                if score.score > _STRONG_THRESHOLD:
                    strong += 1
                elif score.score >= _MEDIUM_THRESHOLD:
                    medium += 1
                else:
                    low += 1
            breakdown.append(
                {
                    "company": job.company,
                    "role": job.role,
                    "score": score.score if score else None,
                    "status": job.status,
                }
            )

        summary = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_jobs": len(jobs),
            "strong_matches": strong,
            "medium_matches": medium,
            "low_matches": low,
            "resumes_ready": len(tailored_job_ids),
            "job_breakdown": breakdown,
        }

    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2))

    send_success_alert(
        f"SKYNET Morning Summary: {summary['total_jobs']} jobs found, "
        f"{summary['strong_matches']} strong matches, {summary['resumes_ready']} resumes ready"
    )
    return summary


def load_latest_summary() -> dict:
    if not SUMMARY_PATH.exists():
        return {"error": "no summary generated yet — run `jobs summary` without --cached first"}
    return json.loads(SUMMARY_PATH.read_text())
