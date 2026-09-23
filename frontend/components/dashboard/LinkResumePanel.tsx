"use client";

import { useEffect, useRef, useState } from "react";

import type { LinkResumeRequestStatus } from "@/lib/dashboard/types";

const POLL_INTERVAL_MS = 3000;

// Paste a job posting link, get the tailored PDF sent straight to your
// phone — the on-demand path that doesn't wait for the hourly pipeline.
// POSTs to /api/dashboard/link-resume (inserts a link_resume_requests row
// and immediately triggers the GitHub Actions workflow that does the real
// scrape/score/tailor/render/send work), then polls that row's status
// until it's done or failed, since the Actions run isn't synchronous from
// this request's point of view.
//
// TEMPORARY (2026-09-23): delivery is standing in with Telegram (see
// backend/app/telegram_delivery.py's docstring) while a Meta account
// device-trust hold blocks WhatsApp Cloud API signup — hence "Telegram"
// in the copy below instead of "WhatsApp". The backend's whatsapp_status
// field/API shape is unchanged either way; revert this copy back to
// "WhatsApp" once that swap reverts.
export function LinkResumePanel() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<LinkResumeRequestStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setSubmitError(null);
    setStatus(null);
    stopPolling();

    try {
      const res = await fetch("/api/dashboard/link-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Couldn't start processing that link.");
        setSubmitting(false);
        return;
      }
      setStatus({ id: data.requestId, status: "pending", score: null, drive_link: null, whatsapp_status: null, error: null });

      pollRef.current = setInterval(async () => {
        const pollRes = await fetch(`/api/dashboard/link-resume/${data.requestId}`);
        if (!pollRes.ok) return;
        const pollData: LinkResumeRequestStatus = await pollRes.json();
        setStatus(pollData);
        if (pollData.status !== "pending") {
          stopPolling();
          setSubmitting(false);
        }
      }, POLL_INTERVAL_MS);
    } catch {
      setSubmitError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="glass-panel flex flex-col gap-3 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.15em] text-[var(--foreground)]/50">Paste a job link</div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          required
          placeholder="https://company.com/careers/job-id"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={submitting}
          className="min-w-[14rem] flex-1 rounded-lg border-none bg-white/5 px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="rounded-full bg-[var(--glow-primary)]/30 px-4 py-2 text-xs text-[var(--foreground)] disabled:opacity-40"
        >
          {submitting ? "Working…" : "Score, tailor, and send to Telegram"}
        </button>
      </form>

      {submitError && <p className="text-xs text-[var(--glow-danger)]">{submitError}</p>}

      {status && (
        <div className="text-xs text-[var(--foreground)]/70">
          {status.status === "pending" && <span>Reading the posting, scoring it, and tailoring your resume…</span>}
          {status.status === "failed" && (
            <span className="text-[var(--glow-danger)]">{status.error ?? "That request failed."}</span>
          )}
          {status.status === "done" && (
            <span>
              Fit score {status.score}.{" "}
              {status.whatsapp_status === "sent"
                ? "Sent to Telegram."
                : status.whatsapp_status
                  ? `Telegram: ${status.whatsapp_status}.`
                  : ""}{" "}
              {status.drive_link && (
                <a href={status.drive_link} target="_blank" rel="noreferrer" className="underline">
                  View resume
                </a>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
