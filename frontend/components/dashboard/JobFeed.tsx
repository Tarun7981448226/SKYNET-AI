"use client";

import { useEffect, useState } from "react";

import { JobCard } from "@/components/dashboard/JobCard";
import { sourceGroup, sourceLabel } from "@/lib/dashboard/sourceLabels";
import type { DashboardJob, JobFilters } from "@/lib/dashboard/types";

function buildQuery(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.decision !== "all") params.set("decision", filters.decision);
  if (filters.minScore !== null) params.set("minScore", String(filters.minScore));
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.source) params.set("source", filters.source);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return params.toString();
}

export function JobFeed({
  filters,
  refreshKey,
  onDecisionMade,
}: {
  filters: JobFilters;
  refreshKey: number;
  onDecisionMade?: () => void;
}) {
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/jobs?${buildQuery(filters)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setJobs([]);
        } else {
          setJobs(data.jobs ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load jobs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, refreshKey]);

  async function handleDecision(jobId: number, decision: "applied" | "rejected" | null) {
    const previous = jobs;
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, user_decision: decision } : job)));
    const res = await fetch(`/api/dashboard/jobs/${jobId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      setJobs(previous);
    } else {
      onDecisionMade?.();
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--foreground)]/50">Loading jobs…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--glow-danger)]">{error}</p>;
  }
  if (jobs.length === 0) {
    return <p className="text-sm text-[var(--foreground)]/50">No jobs match these filters.</p>;
  }

  // The "All" tab branches by where each job actually came from — Pending/
  // Applied/Rejected stay a flat list since those are already a meaningful
  // grouping on their own, and so does "All" once a specific source is
  // already picked (branching by source when it's already the active
  // filter would just show one redundant single-group header).
  if (filters.decision === "all" && !filters.source) {
    const groups = new Map<string, DashboardJob[]>();
    for (const job of jobs) {
      const key = sourceGroup(job.source);
      const existing = groups.get(key);
      if (existing) existing.push(job);
      else groups.set(key, [job]);
    }
    return (
      <div className="flex flex-col gap-5">
        {Array.from(groups.entries()).map(([group, groupJobs]) => (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-[0.15em] text-[var(--foreground)]/50">
              {sourceLabel(group)} <span className="text-[var(--foreground)]/30">({groupJobs.length})</span>
            </h3>
            <div className="flex flex-col gap-2">
              {groupJobs.map((job) => (
                <JobCard key={job.id} job={job} onDecision={handleDecision} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} onDecision={handleDecision} />
      ))}
    </div>
  );
}
