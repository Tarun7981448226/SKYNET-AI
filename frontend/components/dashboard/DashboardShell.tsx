"use client";

import { useEffect, useState } from "react";

import { SiriOrb } from "@/components/dashboard/SiriOrb";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { Filters } from "@/components/dashboard/Filters";
import { JobFeed } from "@/components/dashboard/JobFeed";
import { LinkResumePanel } from "@/components/dashboard/LinkResumePanel";
import { DEFAULT_FILTERS, type DashboardStats, type JobFilters } from "@/lib/dashboard/types";

// The default view is just the orb — nothing else. Say "open dashboard" to
// SKYNET to reveal the real dashboard (stats, filters, job feed) below it,
// "hide dashboard" / "close dashboard" to go back to the clean empty view.
// No visible sign-out button either — "sign out" is a voice command
// handled inside SiriOrb itself (lib/voice/assistant.ts).
export function DashboardShell() {
  const [dashboardVisible, setDashboardVisible] = useState(false);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);

  useEffect(() => {
    if (!dashboardVisible) return;
    let cancelled = false;
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setStatsError(data.error);
        } else {
          setStats(data);
          setStatsError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setStatsError("Couldn't load stats.");
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardVisible, statsRefreshKey]);

  return (
    <>
      <div className="flex items-start justify-end">
        <SiriOrb
          onShowDashboard={() => setDashboardVisible(true)}
          onHideDashboard={() => setDashboardVisible(false)}
        />
      </div>
      {dashboardVisible && (
        <div className="mt-10 flex flex-col gap-4">
          <h1 className="text-2xl font-semibold tracking-[0.08em] text-[var(--foreground)]">Dashboard</h1>
          {statsError && <p className="text-sm text-[var(--glow-danger)]">{statsError}</p>}
          {stats && <StatsBar stats={stats} />}
          <LinkResumePanel />
          <Filters filters={filters} onChange={setFilters} />
          <JobFeed
            filters={filters}
            refreshKey={statsRefreshKey}
            onDecisionMade={() => setStatsRefreshKey((k) => k + 1)}
          />
        </div>
      )}
    </>
  );
}
