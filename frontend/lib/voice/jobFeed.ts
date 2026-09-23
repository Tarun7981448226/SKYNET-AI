import type { DashboardJob } from "@/lib/dashboard/types";

// "Read me my best match" — the jobs route has no score-sort (it orders by
// created_at desc, same as the dashboard's default feed), so this fetches a
// working window and picks the highest score client-side rather than
// changing the shared route's ordering for one caller.
export function isTopMatchQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return /\b(read|tell) me (my )?(best|top) match\b/.test(normalized) || /\bwhat'?s my (best|top) match\b/.test(normalized);
}

export function isPendingQuery(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return /\bwhat'?s (still )?pending\b/.test(normalized) || /\bany(thing)? pending\b/.test(normalized);
}

const DOMAIN_KEYWORDS: Record<string, string> = {
  "ai/ml": "ai_ml",
  "ai ml": "ai_ml",
  "a.i.": "ai_ml",
  "ai": "ai_ml",
  "ml": "ai_ml",
  "machine learning": "ai_ml",
  swe: "swe",
  software: "swe",
};

// "Any AI/ML jobs today?" / "any SWE jobs?" — a small keyword map into the
// jobs route's existing `domain` filter (ai_ml/swe are the two domains with
// a prepared resume file per the tailoring pipeline; data_science/other
// jobs are flagged, not tailored, so there's nothing useful to read there
// yet).
export function parseDomainQuery(transcript: string): string | null {
  const normalized = transcript.trim().toLowerCase();
  if (!/\bjobs?\b/.test(normalized) || !/\bany\b/.test(normalized)) return null;
  for (const [keyword, domain] of Object.entries(DOMAIN_KEYWORDS)) {
    if (normalized.includes(keyword)) return domain;
  }
  return null;
}

export type DecisionWord = "applied" | "rejected";

// "mark that applied", "apply to that", "reject that/it", "mark it
// rejected" — deliberately requires "that"/"it" (a referent), not just the
// bare word "applied"/"rejected" alone, so an unrelated sentence that
// happens to contain "rejected" (e.g. answering a general question) isn't
// misread as an action.
export function parseDecisionCommand(transcript: string): DecisionWord | null {
  const normalized = transcript.trim().toLowerCase();
  if (!/\b(that|it)\b/.test(normalized)) return null;
  if (/\breject(ed)?\b/.test(normalized)) return "rejected";
  if (/\bappl(y|ied)\b/.test(normalized)) return "applied";
  return null;
}

const ORDINAL_WORDS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };

// "the third one (down)", "the second job", "number 2" — resolves a
// position in the list most recently read aloud. Pending/domain queries cap
// at 3 spoken items (see fetchPending/fetchByDomain below), so only
// ordinals 1-3 are ever meaningful.
export function parseOrdinal(transcript: string): number | null {
  const normalized = transcript.trim().toLowerCase();
  const numberMatch = normalized.match(/\bnumber\s+(\d+)\b/);
  if (numberMatch) {
    const n = Number(numberMatch[1]);
    return n >= 1 && n <= 3 ? n : null;
  }
  for (const [word, n] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return n;
  }
  return null;
}

// "mark the third one applied", "reject the second one" — an ordinal and a
// decision spoken together, resolved against the list most recently read
// aloud rather than the single lastMentionedJobRef referent.
export function parseOrdinalDecisionCommand(transcript: string): { ordinal: number; decision: DecisionWord } | null {
  const ordinal = parseOrdinal(transcript);
  if (!ordinal) return null;
  const normalized = transcript.trim().toLowerCase();
  if (/\breject(ed)?\b/.test(normalized)) return { ordinal, decision: "rejected" };
  if (/\bappl(y|ied)\b/.test(normalized)) return { ordinal, decision: "applied" };
  return null;
}

function describeScore(job: DashboardJob): string {
  return job.score === null ? "" : `, score ${job.score}`;
}

export function describeJob(job: DashboardJob): string {
  return `the ${job.role} role at ${job.company}`;
}

export function buildTopMatchAnswer(job: DashboardJob | null): string {
  if (!job) return "You don't have any scored matches yet.";
  return `Your best match is ${job.role} at ${job.company}${describeScore(job)}.`;
}

function buildJobListAnswer(jobs: DashboardJob[], noneMessage: string, label: string): string {
  if (jobs.length === 0) return noneMessage;
  const names = jobs.slice(0, 3).map((j) => `${j.role} at ${j.company}`);
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `You have ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} ${label}: ${list}.`;
}

export function buildPendingAnswer(jobs: DashboardJob[]): string {
  return buildJobListAnswer(jobs, "Nothing pending right now.", "pending");
}

export function buildDomainAnswer(jobs: DashboardJob[]): string {
  return buildJobListAnswer(jobs, "No jobs in that domain right now.", "in that domain");
}

async function fetchJobs(params: Record<string, string>): Promise<DashboardJob[]> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`/api/dashboard/jobs?${query}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs?: DashboardJob[] };
  return data.jobs ?? [];
}

export async function fetchTopMatch(): Promise<DashboardJob | null> {
  const jobs = await fetchJobs({ limit: "20" });
  const scored = jobs.filter((j) => j.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((best, j) => ((j.score ?? 0) > (best.score ?? 0) ? j : best));
}

export async function fetchPending(): Promise<DashboardJob[]> {
  return fetchJobs({ decision: "pending", limit: "3" });
}

export async function fetchByDomain(domain: string): Promise<DashboardJob[]> {
  return fetchJobs({ domain, limit: "3" });
}

export async function postDecision(id: number, decision: DecisionWord): Promise<boolean> {
  const res = await fetch(`/api/dashboard/jobs/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return res.ok;
}
