import { buildJobStatus } from "@/lib/voice/jobStatus";
import type { DashboardStats } from "@/lib/dashboard/types";

// The real morning briefing spoken unprompted on load (SiriOrb.tsx) —
// replaces a plain "Good morning, Mr. Tarun." with the same new-jobs/good-fit
// sentence the "job status" voice query already builds (buildJobStatus),
// plus whatever else is actionable right now (pending review, resumes ready).
export function buildMorningBriefing(greeting: string, stats: DashboardStats): string {
  const extras: string[] = [];
  if (stats.pending > 0) {
    extras.push(`${stats.pending} ${stats.pending === 1 ? "job is" : "jobs are"} still waiting on your decision`);
  }
  if (stats.resumesReady > 0) {
    extras.push(`${stats.resumesReady} tailored ${stats.resumesReady === 1 ? "resume is" : "resumes are"} ready to send`);
  }
  const extrasPart = extras.length > 0 ? ` ${extras.join(", and ")}.` : "";
  return `${greeting} ${buildJobStatus(stats)}${extrasPart}`;
}

export async function getMorningBriefing(greeting: string): Promise<string> {
  // A plain greeting is always better than silence — this fetch runs
  // unprompted on every page load, so any failure (network error, the
  // stats route being down, an unexpected response shape) must fall back
  // to greetingTextRef's plain time-of-day text, not throw and leave
  // SiriOrb.tsx's handleEveArrived awaiting a rejected promise forever.
  try {
    const res = await fetch("/api/dashboard/stats");
    if (!res.ok) return greeting;
    const stats = (await res.json()) as DashboardStats & { error?: string };
    if (stats.error) return greeting;
    return buildMorningBriefing(greeting, stats);
  } catch {
    return greeting;
  }
}
