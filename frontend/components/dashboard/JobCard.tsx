"use client";

import { useState } from "react";

import { GlassButton } from "@/components/GlassButton";
import type { DashboardJob } from "@/lib/dashboard/types";

// Same thresholds as backend/app/summary.py's strong/medium/low matches.
function scoreColor(score: number | null): string {
  if (score === null) return "text-[var(--foreground)]/50";
  if (score > 75) return "text-[var(--glow-primary)]";
  if (score >= 50) return "text-[var(--hot-rod-red)]";
  return "text-[var(--foreground)]/50";
}

export function JobCard({
  job,
  onDecision,
}: {
  job: DashboardJob;
  onDecision: (jobId: number, decision: "applied" | "rejected" | null) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function handleDecision(decision: "applied" | "rejected" | null) {
    setPending(true);
    try {
      await onDecision(job.id, decision);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="glass-panel flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">{job.role}</div>
          <div className="text-xs text-[var(--foreground)]/70">
            {job.company}
            {job.location ? ` — ${job.location}` : ""}
          </div>
        </div>
        <div className={`text-lg font-semibold ${scoreColor(job.score)}`}>
          {job.score !== null ? job.score : "—"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--foreground)]/50">
        {job.domain && <span>{job.domain}</span>}
        {job.type && <span>{job.type}</span>}
        {job.visa_flag && <span className="text-[var(--glow-danger)]">visa flag</span>}
        {job.user_decision && (
          <span className={job.user_decision === "applied" ? "text-[var(--glow-primary)]" : "text-[var(--glow-danger)]"}>
            {job.user_decision}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <GlassButton
          variant="primary"
          className="!px-3 !py-1 text-xs"
          disabled={pending || job.user_decision === "applied"}
          onClick={() => handleDecision("applied")}
        >
          Apply
        </GlassButton>
        <GlassButton
          variant="danger"
          className="!px-3 !py-1 text-xs"
          disabled={pending || job.user_decision === "rejected"}
          onClick={() => handleDecision("rejected")}
        >
          Reject
        </GlassButton>
        {job.drive_link ? (
          <a
            href={job.drive_link}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-button !px-3 !py-1 text-xs text-[var(--foreground)]/80 hover:text-[var(--foreground)]"
          >
            View Resume
          </a>
        ) : (
          // No resume exists for this job yet — either it hasn't been
          // scored/tailored at all, or it scored below the pipeline's
          // tailoring threshold. Spelling that out beats a silently
          // missing button, which otherwise looks like a bug.
          <span className="text-xs text-[var(--foreground)]/40">
            {job.status === "tailored" ? "resume pending" : job.score !== null ? "not tailored (below match threshold)" : "not scored yet"}
          </span>
        )}
        {job.apply_url && (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
          >
            Job posting ↗
          </a>
        )}
      </div>
    </div>
  );
}
