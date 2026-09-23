import type { DashboardStats } from "@/lib/dashboard/types";

// Same shape as jobStatus.ts's single summary query, split into several
// specific spoken-data queries against the same already-live
// GET /api/dashboard/stats — no backend changes, just more of what's
// already fetched. Checked as separate phrase matchers (not one combined
// regex) so each reads naturally and stays independently testable.
export function isNewTodayQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return /\bhow many (new )?jobs?\b.*\btoday\b/.test(normalized) || /\bany (new )?jobs? today\b/.test(normalized);
}

export function isAppliedCountQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return /\bhow many (jobs? )?(have i |i've )?applied\b/.test(normalized) || /\bapplied count\b/.test(normalized);
}

export function isStrongMatchQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return /\bhow many strong matches?\b/.test(normalized) || /\bstrong matches? (do i have|are there)\b/.test(normalized);
}

export function isResumesReadyQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  // A short gap allows "are"/"is" between the noun and "ready" ("are my
  // resumes ready", "how many resumes are ready") without over-matching an
  // unrelated sentence that just happens to contain both words far apart.
  return /\bresumes?\b.{0,15}\bready\b/.test(normalized);
}

export function buildNewTodayAnswer(stats: DashboardStats): string {
  if (stats.newToday === 0) return "No new jobs came in today.";
  return `${stats.newToday} new ${stats.newToday === 1 ? "job" : "jobs"} came in today.`;
}

export function buildAppliedCountAnswer(stats: DashboardStats): string {
  if (stats.applied === 0) return "You haven't applied to any jobs yet.";
  return `You've applied to ${stats.applied} ${stats.applied === 1 ? "job" : "jobs"}.`;
}

export function buildStrongMatchAnswer(stats: DashboardStats): string {
  if (stats.strongMatches === 0 && stats.mediumMatches === 0) {
    return "No strong or medium matches right now.";
  }
  if (stats.mediumMatches === 0) {
    return `${stats.strongMatches} strong ${stats.strongMatches === 1 ? "match" : "matches"}.`;
  }
  return `${stats.strongMatches} strong and ${stats.mediumMatches} medium ${stats.mediumMatches === 1 ? "match" : "matches"}.`;
}

export function buildResumesReadyAnswer(stats: DashboardStats): string {
  if (stats.resumesReady === 0) return "No resumes ready yet.";
  return `${stats.resumesReady} ${stats.resumesReady === 1 ? "resume is" : "resumes are"} ready.`;
}

async function fetchStats(): Promise<DashboardStats | null> {
  const res = await fetch("/api/dashboard/stats");
  if (!res.ok) return null;
  const stats = (await res.json()) as DashboardStats & { error?: string };
  if (stats.error) return null;
  return stats;
}

const UNREACHABLE = "I couldn't reach your job stats right now.";

export async function getNewTodayAnswer(): Promise<string> {
  const stats = await fetchStats();
  return stats ? buildNewTodayAnswer(stats) : UNREACHABLE;
}

export async function getAppliedCountAnswer(): Promise<string> {
  const stats = await fetchStats();
  return stats ? buildAppliedCountAnswer(stats) : UNREACHABLE;
}

export async function getStrongMatchAnswer(): Promise<string> {
  const stats = await fetchStats();
  return stats ? buildStrongMatchAnswer(stats) : UNREACHABLE;
}

export async function getResumesReadyAnswer(): Promise<string> {
  const stats = await fetchStats();
  return stats ? buildResumesReadyAnswer(stats) : UNREACHABLE;
}
