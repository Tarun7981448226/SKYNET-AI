import type { DashboardStats } from "@/lib/dashboard/types";

// "job status" is the trigger phrase — deliberately separate from the
// general Q&A agent so this always answers from real live stats instead of
// Gemini's guess. Matches "job status", "status of my jobs/job search", and
// "how's the job search (going)".
export function isJobStatusQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return (
    /\bjob status\b/.test(normalized) ||
    /\bstatus of (the |my )?jobs?\b/.test(normalized) ||
    /\bhow('?s| is| are) (the |my )?job search\b/.test(normalized)
  );
}

// "Good fit" = strong + medium matches (same 50-and-up bucket the dashboard
// already colors as worth a look), not just the top-tier strong matches.
export function buildJobStatus(stats: DashboardStats): string {
  const goodFit = stats.strongMatches + stats.mediumMatches;

  const searchedPart =
    stats.newToday > 0
      ? `SKYNET found ${stats.newToday} new ${stats.newToday === 1 ? "job" : "jobs"} today`
      : "SKYNET didn't find any new jobs today";

  const fitPart =
    goodFit > 0
      ? `${goodFit} ${goodFit === 1 ? "of them looks" : "of them look"} like a good fit for your background.`
      : "none of them look like a strong fit for your background yet.";

  return `${searchedPart}, and ${fitPart}`;
}

export async function getJobStatus(): Promise<string> {
  const res = await fetch("/api/dashboard/stats");
  if (!res.ok) {
    return "I couldn't reach your job stats right now.";
  }
  const stats = (await res.json()) as DashboardStats & { error?: string };
  if (stats.error) {
    return "I couldn't reach your job stats right now.";
  }
  return buildJobStatus(stats);
}
