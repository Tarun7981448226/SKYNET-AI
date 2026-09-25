import type { DashboardJob, LinkResumeRequestStatus } from "@/lib/dashboard/types";

// Guided "tailor/ready the resume" flow — SiriOrb.tsx drives a short
// company -> role -> location Q&A instead of trying to parse all three out
// of one spoken sentence. Trying to extract a variable-length company name
// out of one free-form sentence kept breaking on real speech-to-text noise
// in a different shape each time (a one-word company split into two words,
// a misheard filler word swallowing part of the name); separately, a
// single company name alone can't disambiguate which job when it has
// several open roles across different domains/locations (e.g. Skyworks).
// Three short, isolated answers are both easier for speech-to-text to get
// right and enough information to pick the exact job — no LLM needed.

const TRIGGER_WORDS = /\b(tailor|ready|generate|prepare)\b/;
// "linkedin" is included here deliberately: in live use Tarun has said
// "send it to my linkedin" meaning Telegram (LinkedIn is a job *source* in
// this pipeline, never a delivery channel) — treated as the same intent
// rather than a literal, unsupported request.
const DELIVER_WORDS = /\b(telegram|linkedin)\b/;

// Detects the opening trigger only ("tailor/ready the resume...") — company
// name is never expected here anymore, it's asked for as a separate turn.
export function detectCompanyResumeTrigger(transcript: string): { sendTelegram: boolean } | null {
  const normalized = transcript.trim().toLowerCase();
  // Let the "score the link I just copied" flow handle these instead —
  // it also matches /\btailor\b/.
  if (/\b(clipboard|copied)\b/.test(normalized)) return null;
  if (!TRIGGER_WORDS.test(normalized) || !/\bresume\b/.test(normalized)) return null;
  return { sendTelegram: DELIVER_WORDS.test(normalized) };
}

const WILDCARD_ANSWERS = new Set([
  "any",
  "anywhere",
  "anything",
  "whatever",
  "skip",
  "none",
  "no preference",
  "not sure",
  "doesn't matter",
  "does not matter",
]);

const LEADING_FILLER = /^(it'?s|that'?s|um+h?|the company is|the role is|the location is|in)\s+/;

// Cleans one isolated slot answer — a much smaller job than the old
// full-sentence extraction, since there's no surrounding command phrasing
// to strip here, just an occasional filler word at the very front. Returns
// null for a wildcard ("any", "doesn't matter") — that slot is then left
// unconstrained rather than searched on literally.
export function cleanSlotAnswer(transcript: string): string | null {
  const normalized = transcript.trim().toLowerCase().replace(LEADING_FILLER, "").trim();
  if (!normalized || WILDCARD_ANSWERS.has(normalized)) return null;
  return normalized;
}

// Single leftover glue words speech-to-text tends to mishear a nearby word
// into — stripped so a bare stopword can never be used as its own search
// term (an "ilike '%to%'" search is far too broad and once surfaced a
// wrong job live).
const STOPWORDS = new Set(["to", "the", "a", "an", "it", "that", "of", "and", "my"]);

async function searchJobs(search: string, limit = 20): Promise<DashboardJob[]> {
  const query = new URLSearchParams({ search, limit: String(limit) }).toString();
  const res = await fetch(`/api/dashboard/jobs?${query}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs?: DashboardJob[] };
  return data.jobs ?? [];
}

async function searchJobsByCompany(company: string): Promise<DashboardJob[]> {
  const words = company.split(" ").filter(Boolean);
  const firstWordCandidate = words[0] && !STOPWORDS.has(words[0]) ? words[0] : null;
  // Speech-to-text splits one-word company names into two ("Robinhood"
  // heard as "Robin Hood") often enough that a plain search misses a real,
  // visible-on-the-dashboard job entirely — try the answer as heard, then
  // the words mashed together, then just the first word, stopping at the
  // first attempt that actually finds something.
  const candidates = Array.from(
    new Set([company, words.join(""), firstWordCandidate].filter((c): c is string => !!c)),
  );
  for (const candidate of candidates) {
    const jobs = await searchJobs(candidate);
    if (jobs.length > 0) return jobs;
  }
  return [];
}

// Narrows a company's jobs down by role/location when either was given
// (both optional — a wildcard answer clears that constraint): prefers a
// job matching both, then either one alone, then falls back to just the
// company if nothing narrows further, rather than finding nothing at all
// over an unmet secondary constraint.
export async function findJobByDetails(
  company: string,
  role: string | null,
  place: string | null,
): Promise<DashboardJob | null> {
  const jobs = (await searchJobsByCompany(company)).filter((j) => !!j.apply_url);
  if (jobs.length === 0) return null;

  const roleWords = role?.split(/\s+/).filter(Boolean) ?? [];
  const placeWords = place?.split(/\s+/).filter(Boolean) ?? [];
  const matchesRole = (j: DashboardJob) => roleWords.some((w) => j.role.toLowerCase().includes(w));
  const matchesPlace = (j: DashboardJob) => placeWords.some((w) => (j.location ?? "").toLowerCase().includes(w));

  const buckets = [
    jobs.filter((j) => (roleWords.length === 0 || matchesRole(j)) && (placeWords.length === 0 || matchesPlace(j))),
    roleWords.length > 0 ? jobs.filter(matchesRole) : [],
    placeWords.length > 0 ? jobs.filter(matchesPlace) : [],
    jobs,
  ];
  for (const bucket of buckets) {
    if (bucket.length > 0) return bucket[0];
  }
  return null;
}

export function describeCompanyResumeResult(
  status: LinkResumeRequestStatus,
  sendTelegram: boolean,
  company: string,
): string {
  if (status.status === "failed") {
    return status.error ?? `Couldn't finish that for ${company}.`;
  }
  if (sendTelegram) {
    const delivered = status.whatsapp_status === "sent";
    return `${company} resume ready, fit score ${status.score}. ${
      delivered ? "Sent to your Telegram." : "Telegram delivery failed — check the dashboard."
    }`;
  }
  return `${company} resume tailored, fit score ${status.score}. It's in your pending dashboard now.`;
}
