import argparse
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from app.alerts import send_gmail_failure_alert, send_sheets_failure_alert, send_source_failure_alert
from app.dedupe import compute_hash
from app.db import SessionLocal
from app.models import FitScore, Job, LinkResumeRequest, RawPost, SheetSyncLog, Source, TailoredResume
from app.parsing.parser import ParseError, parse_raw_post
from app.push_notify import notify_resume_ready
from app.resume.loader import load_resume
from app.scoring.scorer import ScoreError, score_job
from app.sheets.sheets_logger import (
    SheetsError,
    init_sheets,
    log_flagged_job_to_sheets,
    log_job_to_sheets,
    update_tailored_resume_path,
)
from app.sources.base import RawJobPosting, SourceAdapter
from app.sources.link_paste import LinkFetchError, fetch_job_page_text
from app.tailoring.tailor import tailor_resume
from app.tailoring.schema import TailoredResumeContent
from app.rendering.resume_render import generate_docx, generate_pdf
from app.rendering.drive_upload import DriveUploadError, trash_drive_file, upload_to_drive

# TEMPORARY (2026-09-23): standing in for app.whatsapp's real Meta WhatsApp
# Cloud API delivery while a device-trust security hold on Tarun's Meta
# account blocks him from creating the WhatsApp Cloud API app himself — see
# app/telegram_delivery.py's docstring for the full story and exact revert
# steps once that clears.
from app.telegram_delivery import TelegramDeliveryError, send_resume_document

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
# httpx (used by python-telegram-bot) logs full request URLs at INFO level,
# which for the Telegram Bot API embeds the bot token in the path
# (api.telegram.org/bot<TOKEN>/method) — secrets-hygiene: never log secrets.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def _get_adapter(name: str) -> SourceAdapter:
    if name == "greenhouse":
        from app.sources.greenhouse_lever import GreenhouseAdapter

        return GreenhouseAdapter()
    if name == "lever":
        from app.sources.greenhouse_lever import LeverAdapter

        return LeverAdapter()
    if name == "telegram":
        from app.sources.telegram_channels import TelegramChannelsAdapter

        return TelegramChannelsAdapter()
    if name == "gmail_linkedin":
        from app.sources.gmail_linkedin_alerts import GmailLinkedInAlertsAdapter

        return GmailLinkedInAlertsAdapter()
    if name == "share_bot":
        from app.sources.share_bot import ShareBotAdapter

        return ShareBotAdapter()
    raise ValueError(f"Unknown source: {name}")


def _get_or_create_source(session, name: str, type_: str) -> Source:
    source = session.query(Source).filter_by(name=name).first()
    if source is None:
        source = Source(name=name, type=type_)
        session.add(source)
        session.commit()
    return source


def _store_posting(session, posting: RawJobPosting) -> str:
    """Returns 'new', 'duplicate'."""
    source = _get_or_create_source(session, posting.source_name, posting.source_name.split(":")[0])
    raw_post = RawPost(
        source_id=source.id,
        external_id=posting.external_id,
        url=posting.url,
        posted_date=posting.posted_date,
        deadline=posting.deadline,
        raw_text=posting.raw_text,
        content_hash=compute_hash(posting.raw_text),
    )
    session.add(raw_post)
    try:
        session.commit()
        return "new"
    except IntegrityError:
        session.rollback()
        return "duplicate"


def run_ingest(source: str) -> dict:
    """Fetch+store for one poll-based source. Used by both `ingest` and the
    scheduler's hourly job — on failure, alerts instead of raising, so one
    bad source doesn't take down the rest of a scheduled run."""
    counts = {"fetched": 0, "new": 0, "duplicate": 0, "error": 0}
    try:
        adapter = _get_adapter(source)
        postings = adapter.fetch()
    except Exception as exc:
        logger.warning("ingest failed for %s: %s", source, exc)
        if source == "gmail_linkedin":
            send_gmail_failure_alert(str(exc))
        else:
            send_source_failure_alert(source)
        counts["error"] = 1
        return counts

    counts["fetched"] = len(postings)
    with SessionLocal() as session:
        for posting in postings:
            result = _store_posting(session, posting)
            counts[result] += 1
    return counts


def cmd_ingest(args: argparse.Namespace) -> None:
    counts = run_ingest(args.source)
    print(f"fetched={counts['fetched']} new={counts['new']} duplicate={counts['duplicate']} error={counts['error']}")


def run_parse(limit: int, source: str | None = None) -> dict:
    counts = {"jobs_created": 0, "duplicate": 0, "skipped_not_job": 0, "error": 0}
    with SessionLocal() as session:
        query = session.query(RawPost).filter_by(status="pending")
        source_name = source
        if source_name:
            # Source.name is exact for share_bot/gmail_linkedin but
            # "greenhouse:<slug>" / "lever:<slug>" / "telegram:<channel>"
            # for the multi-target adapters, so match either form.
            query = query.join(Source).filter(
                (Source.name == source_name) | (Source.name.like(f"{source_name}:%"))
            )
        # Newest-first: a job monitor should prioritize fresh postings over
        # working through old backlog, and only newly-fetched raw_posts
        # carry posted_date (older ones predate that capture).
        pending = query.order_by(RawPost.id.desc()).limit(limit).all()
        for raw_post in pending:
            try:
                result = parse_raw_post(raw_post.raw_text, url=raw_post.url)
            except ParseError as exc:
                raw_post.status = "error"
                raw_post.parse_error = str(exc)
                session.commit()
                counts["error"] += 1
                continue
            except Exception as exc:
                # Not a content problem (LLM provider/rate-limit/network
                # failure after retries) - leave raw_post as pending so
                # it's retried next run, and stop the batch since further
                # items will likely hit the same wall right now.
                session.rollback()
                print(f"stopping batch early ({len(pending) - pending.index(raw_post)} remaining): {exc}")
                break

            if not result.is_job or result.job is None:
                raw_post.status = "skipped_not_job"
                session.commit()
                counts["skipped_not_job"] += 1
                continue

            job_fields = result.job
            content_hash = compute_hash(job_fields.company, job_fields.role, job_fields.location or "")
            source_row = session.get(Source, raw_post.source_id)
            job = Job(
                raw_post_id=raw_post.id,
                company=job_fields.company,
                role=job_fields.role,
                type=job_fields.type,
                location=job_fields.location,
                skills=job_fields.skills,
                keywords=job_fields.keywords,
                visa_notes=job_fields.visa_notes,
                domain=job_fields.domain,
                posted_date=raw_post.posted_date,
                # Prefer the source's own structured deadline (e.g. Greenhouse's
                # application_deadline field) over the LLM's prose-based guess.
                deadline=raw_post.deadline or job_fields.deadline,
                apply_url=job_fields.apply_url,
                source=source_row.name if source_row else "unknown",
                content_hash=content_hash,
            )
            session.add(job)
            raw_post.status = "parsed"
            try:
                session.commit()
                counts["jobs_created"] += 1
            except IntegrityError:
                session.rollback()
                raw_post.status = "parsed"
                session.commit()
                counts["duplicate"] += 1
    return counts


def cmd_parse(args: argparse.Namespace) -> None:
    counts = run_parse(args.limit, getattr(args, "source", None))
    print(
        f"jobs_created={counts['jobs_created']} duplicate={counts['duplicate']} "
        f"skipped_not_job={counts['skipped_not_job']} error={counts['error']}"
    )


def _slugify(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")


# Which domain resume backs which parsed job domain (see parsing/parser.py's
# _normalize_domain) — "data_science"/"other"/None have no prepared resume
# yet, so those jobs get flagged in the Sheet instead of tailored against a
# mismatched resume. Add an entry (and data/resume_<domain>.md) to cover a
# new domain later.
_DOMAIN_RESUME_PATHS = {
    "ai_ml": "data/resume_aiml.md",
    "swe": "data/resume_swe.md",
}


def _load_domain_resumes() -> dict:
    resumes = {}
    for domain, path in _DOMAIN_RESUME_PATHS.items():
        try:
            resumes[domain] = load_resume(path)
        except FileNotFoundError:
            print(f"  {path} not found — jobs classified '{domain}' will be flagged instead of tailored.")
    return resumes


# Title-keyword filter for roles that are clearly beyond entry-level/new-grad
# reach regardless of resume content. Found via `jobs gap-report`: a single
# company's board can dump every open role (Staff/Senior/Manager/Architect/
# etc.) into the pipeline with no seniority filter, and no amount of honest
# tailoring changes a title — so skip the wasted Gemini scoring call rather
# than score-and-ignore. Deliberately whole-word/phrase matching (not a loose
# substring) to avoid false-flagging a genuinely entry-level posting that
# happens to share a word; "Engineer I" is intentionally NOT matched (I is
# commonly the entry tier), only II/III/2/3.
_SENIOR_TITLE_RE = re.compile(
    r"\b(staff|senior|sr\.?|principal|director|manager|architect|advocate|vice president|head of|technical account manager)\b",
    re.IGNORECASE,
)
_SENIOR_LEVEL_RE = re.compile(r"\b(?:engineer|specialist|architect)\s+(?:ii|iii|2|3)\b", re.IGNORECASE)


def _looks_senior(role: str) -> bool:
    return bool(_SENIOR_TITLE_RE.search(role) or _SENIOR_LEVEL_RE.search(role))


def run_tailor(limit: int, dry_run: bool = False, min_score: int = 0) -> dict:
    resumes = _load_domain_resumes()
    counts = {
        "scored": 0,
        "tailored": 0,
        "logged": 0,
        "error": 0,
        "skipped_low_score": 0,
        "flagged": 0,
        "flagged_seniority": 0,
    }
    worksheet = None
    if not dry_run:
        try:
            worksheet = init_sheets()
        except SheetsError as exc:
            print(f"Sheets not configured ({exc}); continuing without logging.")

    with SessionLocal() as session:
        jobs = (
            session.query(Job)
            .filter(Job.status == "new")
            .order_by(Job.id.desc())  # newest-parsed first — see cmd_parse
            .limit(limit)
            .all()
        )
        for job in jobs:
            if _looks_senior(job.role):
                print(f"[flagged] {job.company} — {job.role} | title reads senior/non-entry, skipping scoring")
                job.status = "flagged_seniority_mismatch"
                counts["flagged_seniority"] += 1
                session.commit()
                continue

            resume = resumes.get(job.domain)
            if resume is None:
                print(f"[flagged] {job.company} — {job.role} | domain={job.domain!r} has no prepared resume")
                job.status = "flagged_no_resume"
                counts["flagged"] += 1
                if not dry_run and worksheet is not None:
                    try:
                        log_flagged_job_to_sheets(worksheet, job, job.domain)
                    except Exception as exc:
                        print(f"  Sheets logging failed for job {job.id}: {exc}")
                        send_sheets_failure_alert(job.company, job.role)
                session.commit()
                continue

            try:
                score = score_job(job, resume)
            except ScoreError as exc:
                print(f"[error] {job.company} — {job.role}: scoring failed: {exc}")
                counts["error"] += 1
                continue
            except Exception as exc:
                # Not a content problem (LLM provider/rate-limit/network
                # failure) — leave job as "new" to retry next run, and stop
                # the batch since further items will likely hit the same wall.
                print(f"stopping batch early: {exc}")
                break

            session.merge(
                FitScore(
                    job_id=job.id,
                    score=score.score,
                    matched_item_ids=score.matched_item_ids,
                    gaps=score.gaps,
                    rationale=score.rationale,
                    visa_flag=score.visa_flag,
                )
            )
            job.status = "scored"
            session.commit()
            counts["scored"] += 1

            if score.score < min_score:
                counts["skipped_low_score"] += 1
                print(f"[scored] {job.company} — {job.role} | score={score.score} (below min_score={min_score}, not tailoring)")
                continue

            tailored = tailor_resume(resume, job, score)

            pdf_path = docx_path = None
            if not dry_run:
                # Log to the Sheet first (with the resume path still blank)
                # so the row number is known before naming the files — the
                # resume is then named after its row (row 5 -> resume5.pdf)
                # rather than the job id, matching the Sheet at a glance.
                row_number = None
                if worksheet is not None:
                    try:
                        row_number = log_job_to_sheets(worksheet, job, score, pdf_path=None)
                    except Exception as exc:
                        print(f"  Sheets logging failed for job {job.id}: {exc}")
                        send_sheets_failure_alert(job.company, job.role)

                if row_number:
                    base = f"resumes/resume{row_number}"
                else:
                    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
                    name_slug = _slugify(resume.contact.name)
                    base = f"resumes/{name_slug}_{job.id}_{timestamp}"
                pdf_path, docx_path = f"{base}.pdf", f"{base}.docx"
                pdf_scale = generate_pdf(tailored, pdf_path)
                generate_docx(tailored, docx_path, scale=pdf_scale)
                tailored_resume_row = TailoredResume(
                    job_id=job.id,
                    tailored_content=tailored.model_dump(),
                    pdf_path=pdf_path,
                    docx_path=docx_path,
                )
                session.add(tailored_resume_row)
                job.status = "tailored"
                session.commit()
                counts["tailored"] += 1

                if row_number:
                    # Prefer a Drive link over the local path: the runner's
                    # disk (GitHub Actions) or the DB row's pdf_path won't
                    # be reachable once this process exits, but a Drive
                    # link stays open-able from the Sheet indefinitely (and
                    # from the Mark V dashboard's "View Resume").
                    resume_link = pdf_path
                    try:
                        resume_link = upload_to_drive(pdf_path)
                        tailored_resume_row.drive_link = resume_link
                        session.commit()
                    except DriveUploadError as exc:
                        print(f"  Drive upload skipped for job {job.id}: {exc}")
                    except Exception as exc:
                        print(f"  Drive upload failed for job {job.id}: {exc}")

                    try:
                        update_tailored_resume_path(worksheet, row_number, resume_link)
                        session.add(SheetSyncLog(job_id=job.id, sheet_row_ref=str(row_number)))
                        session.commit()
                        counts["logged"] += 1
                    except Exception as exc:
                        print(f"  Sheets resume-path update failed for job {job.id}: {exc}")
                        send_sheets_failure_alert(job.company, job.role)

                # Fires here (after the Drive-upload attempt above, not
                # right after job.status="tailored") so the notification's
                # url can be the real Drive link when upload succeeded,
                # falling back to /dashboard when it didn't or there was no
                # Sheet row to log against.
                notify_resume_ready(job.company, job.role, score.score, tailored_resume_row.drive_link)

            print(
                f"[{job.status}] {job.company} — {job.role} | score={score.score} "
                f"matched={score.matched_item_ids} gaps={score.gaps} visa_flag={score.visa_flag}"
                + (f" | pdf={pdf_path}" if pdf_path else "")
            )
    return counts


def cmd_tailor(args: argparse.Namespace) -> None:
    counts = run_tailor(args.limit, dry_run=args.dry_run, min_score=getattr(args, "min_score", 0))
    print(
        f"scored={counts['scored']} tailored={counts['tailored']} "
        f"logged={counts['logged']} error={counts['error']} skipped_low_score={counts['skipped_low_score']} "
        f"flagged={counts['flagged']} flagged_seniority={counts['flagged_seniority']}"
    )


def cmd_jobs_status(args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        from sqlalchemy import func

        status_counts = dict(session.query(Job.status, func.count(Job.id)).group_by(Job.status).all())
        score_stats = session.query(
            func.count(FitScore.id), func.avg(FitScore.score), func.min(FitScore.score), func.max(FitScore.score)
        ).one()
        tailored_count = session.query(TailoredResume).count()
        logged_count = session.query(SheetSyncLog).count()

        print("Jobs by status:", status_counts)
        n, avg, lo, hi = score_stats
        if n:
            print(f"Scores: n={n} avg={avg:.1f} min={lo} max={hi}")
        else:
            print("Scores: no jobs scored yet")
        print(f"Tailored resumes generated: {tailored_count}")
        print(f"Logged to Sheets: {logged_count}")


def cmd_jobs_list(args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        jobs = session.query(Job).order_by(Job.created_at.desc()).limit(args.limit).all()
        for job in jobs:
            print(f"[{job.status}] {job.company} — {job.role} ({job.type or '?'}, {job.location or '?'}) {job.apply_url or ''}")
        print(f"total shown: {len(jobs)}")


def cmd_jobs_summary(args: argparse.Namespace) -> None:
    from app.summary import generate_morning_summary, load_latest_summary

    summary = load_latest_summary() if args.cached else generate_morning_summary()
    print(summary)


def gap_report(domain: str | None = None, limit: int = 15) -> dict:
    """Aggregates how often each real, LLM-flagged requirement gap
    (FitScore.gaps — see scorer.py's PROMPT_TEMPLATE) recurs across scored
    jobs, grouped by domain. A recurring gap is a genuine signal worth
    reviewing honestly: either it's real resume content that's missing and
    can be truthfully added (see no-fabrication skill — select/reorder/
    reword only, never invent), or it's a class of job that was never a
    realistic fit regardless of resume content, which is useful to know
    too. Read-only — never modifies the resume or the DB."""
    from collections import Counter

    with SessionLocal() as session:
        query = session.query(Job.domain, FitScore.score, FitScore.gaps).join(FitScore, FitScore.job_id == Job.id)
        if domain:
            query = query.filter(Job.domain == domain)
        rows = query.all()

    by_domain: dict[str, list[tuple[int, list[str]]]] = {}
    for job_domain, score, gaps in rows:
        by_domain.setdefault(job_domain or "unclassified", []).append((score, gaps or []))

    report = {}
    for dom, items in by_domain.items():
        counter: Counter = Counter()
        for _, gaps in items:
            for gap in gaps:
                counter[gap.strip().lower()] += 1
        report[dom] = {
            "job_count": len(items),
            "avg_score": sum(s for s, _ in items) / len(items) if items else 0.0,
            "top_gaps": counter.most_common(limit),
        }
    return report


def cmd_jobs_gap_report(args: argparse.Namespace) -> None:
    report = gap_report(domain=args.domain, limit=args.limit)
    if not report:
        print("No scored jobs yet.")
        return
    for domain, data in report.items():
        print(f"--- domain={domain} n={data['job_count']} avg_score={data['avg_score']:.1f} ---")
        for gap, count in data["top_gaps"]:
            print(f"  {count:3d}x  {gap}")


def reclassify_senior_scored_jobs(limit: int = 200) -> dict:
    """One-time catch-up for jobs scored/tailored before _looks_senior()
    existed — run_tailor() only checks new jobs going forward, so anything
    already sitting at status 'scored' or 'tailored' with a senior/non-
    entry title needs a manual pass. Reclassifies to
    flagged_seniority_mismatch (same status run_tailor() now sets going
    forward) and, if a resume was actually generated and uploaded for one
    (it happened for a handful before this filter existed — e.g. a
    "Technical Account Manager" or "Senior Applied Scientist" role), trims
    it with the same trash_drive_file() used for rejected jobs (moved to
    Drive's trash, recoverable there for ~30 days — not permanently
    deleted) and clears drive_link, since a resume tailored for a role
    Tarun was never a realistic candidate for isn't worth the Drive space."""
    counts = {"reclassified": 0, "resumes_trashed": 0, "failed": 0}
    with SessionLocal() as session:
        jobs = (
            session.query(Job)
            .filter(Job.status.in_(["scored", "tailored"]))
            .order_by(Job.id)
            .limit(limit)
            .all()
        )
        for job in jobs:
            if not _looks_senior(job.role):
                continue
            label = f"{job.company} — {job.role}"
            try:
                tailored_resume = session.query(TailoredResume).filter_by(job_id=job.id).first()
                if tailored_resume is not None and tailored_resume.drive_link:
                    trash_drive_file(tailored_resume.drive_link)
                    tailored_resume.drive_link = None
                    counts["resumes_trashed"] += 1
                job.status = "flagged_seniority_mismatch"
                session.commit()
                counts["reclassified"] += 1
                print(f"[reclassified] {label}")
            except Exception as exc:
                session.rollback()
                counts["failed"] += 1
                print(f"[failed] {label}: {exc}")
    return counts


def cmd_jobs_reclassify_senior(args: argparse.Namespace) -> None:
    counts = reclassify_senior_scored_jobs(limit=args.limit)
    print(f"reclassified={counts['reclassified']} resumes_trashed={counts['resumes_trashed']} failed={counts['failed']}")


def backfill_drive_links(limit: int = 100) -> dict:
    """Repairs TailoredResume rows with no drive_link — e.g. the 26 tailored
    before the drive_link column/write existed at all, whose local pdf_path
    is long gone (ephemeral runner disk, gitignored resumes/ dir). Re-renders
    from the already-stored tailored_content JSON (no new LLM call — nothing
    about the resume's wording changes) and re-uploads to Drive, exactly the
    render+upload steps run_tailor() itself already does for new jobs. The
    Mark V dashboard's "View Resume" link reads this same drive_link column."""
    counts = {"repaired": 0, "failed": 0}
    with SessionLocal() as session:
        rows = (
            session.query(TailoredResume)
            .filter(TailoredResume.drive_link.is_(None))
            .order_by(TailoredResume.id)
            .limit(limit)
            .all()
        )
        for row in rows:
            job = session.get(Job, row.job_id)
            label = f"{job.company} — {job.role}" if job else f"job {row.job_id}"
            try:
                tailored = TailoredResumeContent.model_validate(row.tailored_content)
                base = f"resumes/backfill{row.id}"
                pdf_path, docx_path = f"{base}.pdf", f"{base}.docx"
                pdf_scale = generate_pdf(tailored, pdf_path)
                generate_docx(tailored, docx_path, scale=pdf_scale)
                row.drive_link = upload_to_drive(pdf_path)
                session.commit()
                counts["repaired"] += 1
                print(f"[repaired] {label} -> {row.drive_link}")
            except DriveUploadError as exc:
                session.rollback()
                counts["failed"] += 1
                print(f"[skip] {label}: Drive upload not available ({exc})")
            except Exception as exc:
                session.rollback()
                counts["failed"] += 1
                print(f"[failed] {label}: {exc}")
    return counts


def cmd_jobs_backfill_resumes(args: argparse.Namespace) -> None:
    counts = backfill_drive_links(limit=args.limit)
    print(f"repaired={counts['repaired']} failed={counts['failed']}")


def cleanup_rejected_resumes(limit: int = 100) -> dict:
    """Frees Drive space for jobs Tarun has rejected from the dashboard:
    moves each rejected job's resume file to Drive's trash (recoverable
    there for ~30 days — not a permanent delete, since a wrong reject
    click shouldn't be unrecoverable) and clears drive_link so the
    dashboard's "View Resume" stops offering a file that's gone. Drive
    credentials stay Python-side only, same as every other Google API this
    project touches (Sheets, Gmail, Drive upload) — the Next.js dashboard
    never holds them; it just marks user_decision = 'rejected' instantly,
    and this command (run manually or on a schedule) does the actual
    cleanup after."""
    counts = {"cleaned": 0, "failed": 0}
    with SessionLocal() as session:
        rows = (
            session.query(TailoredResume)
            .join(Job, Job.id == TailoredResume.job_id)
            .filter(Job.user_decision == "rejected", TailoredResume.drive_link.isnot(None))
            .order_by(TailoredResume.id)
            .limit(limit)
            .all()
        )
        for row in rows:
            job = session.get(Job, row.job_id)
            label = f"{job.company} — {job.role}" if job else f"job {row.job_id}"
            try:
                trash_drive_file(row.drive_link)
                row.drive_link = None
                session.commit()
                counts["cleaned"] += 1
                print(f"[trashed] {label}")
            except Exception as exc:
                session.rollback()
                counts["failed"] += 1
                print(f"[failed] {label}: {exc}")
    return counts


def cmd_jobs_cleanup_rejected(args: argparse.Namespace) -> None:
    counts = cleanup_rejected_resumes(limit=args.limit)
    print(f"cleaned={counts['cleaned']} failed={counts['failed']}")


def retailor_scored_jobs(limit: int = 100, min_score: int = 50) -> dict:
    """One-time catch-up for jobs that were scored and skipped under an
    older, higher tailor --min-score (60) before it was lowered — run_tailor()
    itself only ever looks at status == 'new' jobs, so a job already left at
    status == 'scored' would otherwise sit there forever even though it now
    clears the new, lower threshold. Reuses the exact same tailor -> render ->
    upload -> Sheets-log steps run_tailor() runs for a fresh job (these were
    never logged to the Sheet either, since the original run skipped them
    before that step)."""
    resumes = _load_domain_resumes()
    counts = {"tailored": 0, "skipped_no_resume": 0, "failed": 0}
    worksheet = None
    try:
        worksheet = init_sheets()
    except SheetsError as exc:
        print(f"Sheets not configured ({exc}); continuing without logging.")

    with SessionLocal() as session:
        rows = (
            session.query(Job, FitScore)
            .join(FitScore, FitScore.job_id == Job.id)
            .filter(Job.status == "scored", FitScore.score >= min_score)
            .order_by(Job.id)
            .limit(limit)
            .all()
        )
        for job, score in rows:
            label = f"{job.company} — {job.role}"
            resume = resumes.get(job.domain)
            if resume is None:
                print(f"[skip] {label}: domain={job.domain!r} has no prepared resume")
                counts["skipped_no_resume"] += 1
                continue
            try:
                tailored = tailor_resume(resume, job, score)

                row_number = None
                if worksheet is not None:
                    try:
                        row_number = log_job_to_sheets(worksheet, job, score, pdf_path=None)
                    except Exception as exc:
                        print(f"  Sheets logging failed for job {job.id}: {exc}")
                        send_sheets_failure_alert(job.company, job.role)

                base = f"resumes/resume{row_number}" if row_number else f"resumes/retailor{job.id}"
                pdf_path, docx_path = f"{base}.pdf", f"{base}.docx"
                pdf_scale = generate_pdf(tailored, pdf_path)
                generate_docx(tailored, docx_path, scale=pdf_scale)
                tailored_resume_row = TailoredResume(
                    job_id=job.id, tailored_content=tailored.model_dump(), pdf_path=pdf_path, docx_path=docx_path
                )
                session.add(tailored_resume_row)
                job.status = "tailored"
                session.commit()

                if row_number:
                    resume_link = pdf_path
                    try:
                        resume_link = upload_to_drive(pdf_path)
                        tailored_resume_row.drive_link = resume_link
                        session.commit()
                    except DriveUploadError as exc:
                        print(f"  Drive upload skipped for job {job.id}: {exc}")
                    try:
                        update_tailored_resume_path(worksheet, row_number, resume_link)
                        session.add(SheetSyncLog(job_id=job.id, sheet_row_ref=str(row_number)))
                        session.commit()
                    except Exception as exc:
                        print(f"  Sheets resume-path update failed for job {job.id}: {exc}")
                        send_sheets_failure_alert(job.company, job.role)

                counts["tailored"] += 1
                print(f"[tailored] {label} | score={score.score} -> {tailored_resume_row.drive_link or pdf_path}")
            except Exception as exc:
                session.rollback()
                counts["failed"] += 1
                print(f"[failed] {label}: {exc}")
    return counts


def cmd_jobs_retailor_scored(args: argparse.Namespace) -> None:
    counts = retailor_scored_jobs(limit=args.limit, min_score=args.min_score)
    print(f"tailored={counts['tailored']} skipped_no_resume={counts['skipped_no_resume']} failed={counts['failed']}")


def _fail_link_request(session, request_row: LinkResumeRequest | None, message: str) -> None:
    print(f"[failed] {message}")
    if request_row is not None:
        request_row.status = "failed"
        request_row.error = message
        request_row.completed_at = datetime.now(timezone.utc)
        session.commit()


def run_link_resume(url: str, request_id: int | None = None, send_telegram: bool = True) -> dict:
    """On-demand pipeline for one job URL Tarun pastes into the dashboard
    (frontend/app/api/dashboard/link-resume) instead of waiting for a
    source adapter to find it: fetch the page -> parse it with the same JD
    parser every other source uses -> score against the matching domain
    resume -> tailor -> render -> upload to Drive -> send the PDF to
    WhatsApp. Triggered via a GitHub Actions workflow_dispatch
    (.github/workflows/link_resume.yml) for an instant feel rather than
    sitting in the hourly cron's queue.

    request_id, when given, is a LinkResumeRequest row's id that the
    dashboard already inserted (status="pending") and is polling — every
    exit path here updates it so the UI has something real to show,
    success or failure, instead of hanging forever.

    send_telegram=False skips the delivery step entirely (used by the
    dashboard's voice "tailor the resume for <company>" command, which
    only wants the job tailored and sitting in the pending dashboard —
    not pushed to Telegram like the "ready + send" voice command and the
    manual paste-a-link box both do by default)."""
    with SessionLocal() as session:
        request_row = session.get(LinkResumeRequest, request_id) if request_id else None

        # An already-ingested job (any source adapter, not just this
        # command's own link_paste) can share this exact apply_url — the
        # dashboard's voice "tailor the resume for <company>" command in
        # particular always starts from an *existing* job's own apply_url,
        # not a fresh link someone just pasted. Re-fetching that URL is
        # often actively wrong there: a job sourced from a Gmail LinkedIn
        # alert has a LinkedIn apply_url that needs a logged-in session to
        # view at all (this pipeline is deliberately never allowed to
        # automate a LinkedIn login/scrape — see CLAUDE.md's security
        # rules), so fetching it anonymously hits a login wall and the JD
        # parser correctly reports "not a job posting" — live-reproduced,
        # twice — even though the real job data is already sitting in this
        # exact row, since gmail_linkedin_alerts.py parsed it out of the
        # alert *email* itself, never the LinkedIn page. Skip the
        # fetch/parse round trip entirely when the row already exists.
        job = session.query(Job).filter(Job.apply_url == url).first()

        if job is None:
            try:
                raw_text = fetch_job_page_text(url)
            except LinkFetchError as exc:
                _fail_link_request(session, request_row, f"couldn't read that page: {exc}")
                return {"status": "failed", "error": str(exc)}

            try:
                parse_result = parse_raw_post(raw_text, url=url)
            except ParseError as exc:
                _fail_link_request(session, request_row, f"couldn't understand that job posting: {exc}")
                return {"status": "failed", "error": str(exc)}

            if not parse_result.is_job or parse_result.job is None:
                _fail_link_request(session, request_row, "that link doesn't look like a job posting")
                return {"status": "failed", "error": "not a job posting"}

            job_fields = parse_result.job

            # jobs has *two* unique constraints (content_hash, and apply_url
            # where not null) — a source adapter can already have this exact
            # posting under a content_hash that doesn't match ours (its own JD
            # parse of the same page can land on slightly different company/
            # role/location text than link_paste's), which used to slip past
            # the content_hash-only lookup below and crash the whole request on
            # apply_url's constraint instead. Check both before inserting.
            content_hash = compute_hash(job_fields.company, job_fields.role, job_fields.location or "")
            apply_url_value = job_fields.apply_url or url
            job = (
                session.query(Job)
                .filter((Job.content_hash == content_hash) | (Job.apply_url == apply_url_value))
                .first()
            )
            if job is None:
                job = Job(
                    company=job_fields.company,
                    role=job_fields.role,
                    type=job_fields.type,
                    location=job_fields.location,
                    skills=job_fields.skills,
                    keywords=job_fields.keywords,
                    visa_notes=job_fields.visa_notes,
                    domain=job_fields.domain,
                    apply_url=apply_url_value,
                    source="link_paste",
                    content_hash=content_hash,
                    status="new",
                )
                session.add(job)
                try:
                    session.commit()
                except IntegrityError:
                    # Lost a race with something else inserting the same
                    # posting between the lookup above and this commit (e.g.
                    # the hourly pipeline mid-run) — the row's real now, just
                    # go find it instead of failing an otherwise-good request.
                    session.rollback()
                    job = (
                        session.query(Job)
                        .filter((Job.content_hash == content_hash) | (Job.apply_url == apply_url_value))
                        .first()
                    )
                    if job is None:
                        raise

        resumes = _load_domain_resumes()
        resume = resumes.get(job.domain)
        if resume is None:
            message = f"no resume prepared yet for domain '{job.domain}'"
            _fail_link_request(session, request_row, message)
            return {"status": "failed", "error": message}

        try:
            score = score_job(job, resume)
        except ScoreError as exc:
            _fail_link_request(session, request_row, f"scoring failed: {exc}")
            return {"status": "failed", "error": str(exc)}

        # session.merge() matches by primary key (FitScore.id), not by the
        # job_id unique constraint — a freshly-constructed FitScore always
        # has id=None, so merge() only ever inserts, never finds an
        # existing row. Harmless for a genuinely new job, but re-processing
        # a job the hourly pipeline already scored (exactly what reusing an
        # existing `job` above means) crashed on fit_scores' own job_id
        # uniqueness. Look it up and update in place instead.
        fit_score_row = session.query(FitScore).filter_by(job_id=job.id).first()
        if fit_score_row is None:
            fit_score_row = FitScore(job_id=job.id)
            session.add(fit_score_row)
        fit_score_row.score = score.score
        fit_score_row.matched_item_ids = score.matched_item_ids
        fit_score_row.gaps = score.gaps
        fit_score_row.rationale = score.rationale
        fit_score_row.visa_flag = score.visa_flag
        job.status = "scored"
        session.commit()

        tailored = tailor_resume(resume, job, score)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        base = f"resumes/link{job.id}_{timestamp}"
        pdf_path, docx_path = f"{base}.pdf", f"{base}.docx"
        pdf_scale = generate_pdf(tailored, pdf_path)
        generate_docx(tailored, docx_path, scale=pdf_scale)

        tailored_resume_row = TailoredResume(
            job_id=job.id, tailored_content=tailored.model_dump(), pdf_path=pdf_path, docx_path=docx_path
        )
        session.add(tailored_resume_row)
        job.status = "tailored"
        session.commit()

        drive_link = None
        try:
            drive_link = upload_to_drive(pdf_path)
            tailored_resume_row.drive_link = drive_link
            session.commit()
        except DriveUploadError as exc:
            print(f"  Drive upload skipped for job {job.id}: {exc}")

        notify_resume_ready(job.company, job.role, score.score, drive_link)

        # Delivery is the point of this whole command *when send_telegram is
        # true*, but a failure here (not configured yet, network hiccup)
        # shouldn't sink an otherwise-successful request: the resume is
        # real and reachable via drive_link either way. Still Telegram
        # under the hood right now (see the TEMPORARY import above) — the
        # whatsapp_status name is the real DB column (frontend/backend/
        # model all reference it) and reverts to meaning WhatsApp again
        # once that swap goes back.
        if send_telegram:
            whatsapp_status = "not configured"
            try:
                caption = f"{job.company} — {job.role} (fit score {score.score})"
                send_resume_document(pdf_path, caption)
                whatsapp_status = "sent"
            except TelegramDeliveryError as exc:
                whatsapp_status = f"failed: {exc}"
                print(f"  Telegram send failed for job {job.id}: {exc}")
        else:
            whatsapp_status = "skipped"

        if request_row is not None:
            request_row.status = "done"
            request_row.job_id = job.id
            request_row.score = score.score
            request_row.drive_link = drive_link
            request_row.whatsapp_status = whatsapp_status
            request_row.completed_at = datetime.now(timezone.utc)
            session.commit()

        print(
            f"[done] {job.company} — {job.role} | score={score.score} "
            f"drive_link={drive_link} whatsapp={whatsapp_status}"
        )
        return {
            "status": "done",
            "job_id": job.id,
            "score": score.score,
            "drive_link": drive_link,
            "whatsapp_status": whatsapp_status,
        }


def cmd_link_resume(args: argparse.Namespace) -> None:
    result = run_link_resume(args.url, request_id=args.request_id, send_telegram=not args.no_telegram)
    print(result)


def cmd_test_alerts(args: argparse.Namespace) -> None:
    from app.alerts import send_error_alert, send_success_alert

    send_error_alert("this is a test error alert from `test-alerts`", error_type="test")
    send_success_alert("this is a test success alert from `test-alerts`")
    print("Sent test error + success alerts. Check Telegram.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="skynet")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest")
    ingest_parser.add_argument(
        "--source", required=True, choices=["greenhouse", "lever", "telegram", "share_bot", "gmail_linkedin"]
    )
    ingest_parser.set_defaults(func=cmd_ingest)

    parse_parser = subparsers.add_parser("parse")
    parse_parser.add_argument("--pending", action="store_true", required=True)
    parse_parser.add_argument("--limit", type=int, default=20)
    parse_parser.add_argument(
        "--source", choices=["greenhouse", "lever", "telegram", "share_bot", "gmail_linkedin"], default=None
    )
    parse_parser.set_defaults(func=cmd_parse)

    tailor_parser = subparsers.add_parser("tailor")
    tailor_parser.add_argument("--pending", action="store_true", required=True)
    tailor_parser.add_argument("--limit", type=int, default=5)
    tailor_parser.add_argument("--dry-run", action="store_true")
    tailor_parser.add_argument("--min-score", type=int, default=0, help="skip tailoring jobs scored below this")
    tailor_parser.set_defaults(func=cmd_tailor)

    jobs_parser = subparsers.add_parser("jobs")
    jobs_subparsers = jobs_parser.add_subparsers(dest="jobs_command", required=True)
    jobs_list_parser = jobs_subparsers.add_parser("list")
    jobs_list_parser.add_argument("--limit", type=int, default=50)
    jobs_list_parser.set_defaults(func=cmd_jobs_list)
    jobs_status_parser = jobs_subparsers.add_parser("status")
    jobs_status_parser.set_defaults(func=cmd_jobs_status)
    jobs_summary_parser = jobs_subparsers.add_parser("summary")
    jobs_summary_parser.add_argument("--cached", action="store_true", help="print the last-saved summary.json instead of generating a fresh one")
    jobs_summary_parser.set_defaults(func=cmd_jobs_summary)
    jobs_gap_report_parser = jobs_subparsers.add_parser("gap-report")
    jobs_gap_report_parser.add_argument("--domain", type=str, default=None, help="restrict to one domain (ai_ml/swe/data_science/other)")
    jobs_gap_report_parser.add_argument("--limit", type=int, default=15, help="how many top recurring gaps to show per domain")
    jobs_gap_report_parser.set_defaults(func=cmd_jobs_gap_report)
    jobs_reclassify_senior_parser = jobs_subparsers.add_parser("reclassify-senior")
    jobs_reclassify_senior_parser.add_argument("--limit", type=int, default=200)
    jobs_reclassify_senior_parser.set_defaults(func=cmd_jobs_reclassify_senior)
    jobs_backfill_parser = jobs_subparsers.add_parser("backfill-resumes")
    jobs_backfill_parser.add_argument("--limit", type=int, default=100)
    jobs_backfill_parser.set_defaults(func=cmd_jobs_backfill_resumes)
    jobs_cleanup_parser = jobs_subparsers.add_parser("cleanup-rejected")
    jobs_cleanup_parser.add_argument("--limit", type=int, default=100)
    jobs_cleanup_parser.set_defaults(func=cmd_jobs_cleanup_rejected)
    jobs_retailor_parser = jobs_subparsers.add_parser("retailor-scored")
    jobs_retailor_parser.add_argument("--limit", type=int, default=100)
    jobs_retailor_parser.add_argument("--min-score", type=int, default=50)
    jobs_retailor_parser.set_defaults(func=cmd_jobs_retailor_scored)

    link_resume_parser = subparsers.add_parser("link-resume")
    link_resume_parser.add_argument("--url", type=str, required=True)
    link_resume_parser.add_argument(
        "--request-id", type=int, default=None, help="link_resume_requests.id to update with the result"
    )
    link_resume_parser.add_argument(
        "--no-telegram",
        action="store_true",
        help="tailor/render/upload only — skip the Telegram delivery step",
    )
    link_resume_parser.set_defaults(func=cmd_link_resume)

    test_alerts_parser = subparsers.add_parser("test-alerts")
    test_alerts_parser.set_defaults(func=cmd_test_alerts)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
