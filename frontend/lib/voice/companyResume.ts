import type { DashboardJob, LinkResumeRequestStatus } from "@/lib/dashboard/types";

// "Tailor the resume for Stripe" / "ready the resume for Stripe and send it
// to my telegram channel" — the hands-free way to act on a job Tarun can
// already see on the dashboard (ingested by a source adapter, not yet
// tailored) without pasting its URL. Reuses the exact same
// POST /api/dashboard/link-resume + GET /api/dashboard/link-resume/[id]
// pair as the manual paste-a-link box and lib/voice/clipboardLink.ts — the
// only new piece is looking the job's apply_url up by company name first,
// and a send_telegram=false toggle so "just tailor" doesn't also deliver.

const TRIGGER_WORDS = /\b(tailor|ready|generate|prepare)\b/;
// "linkedin" is included here deliberately: in live use Tarun has said
// "send it to my linkedin" meaning Telegram (LinkedIn is a job *source* in
// this pipeline, never a delivery channel) — treated as the same intent
// rather than a literal, unsupported request.
const DELIVER_WORDS = /\b(telegram|linkedin)\b/;

// Cheap, synchronous gate — decides whether this transcript is even a
// resume command at all, and which action it wants. Kept as plain regex
// (unlike company-name extraction below) since presence-checking a handful
// of fixed words is exactly what regex is reliable at; it's pulling an
// arbitrary, variable-length company name out of noisy speech-to-text where
// regex kept breaking.
function detectCommand(transcript: string): { sendTelegram: boolean } | null {
  const normalized = transcript.trim().toLowerCase();
  // Let the "score the link I just copied" flow handle these instead —
  // it also matches /\btailor\b/, and a clipboard command never mentions
  // a company by name for this parser to extract anyway.
  if (/\b(clipboard|copied)\b/.test(normalized)) return null;
  if (!TRIGGER_WORDS.test(normalized) || !/\bresume\b/.test(normalized)) return null;
  return { sendTelegram: DELIVER_WORDS.test(normalized) };
}

const FILLER_PATTERNS: RegExp[] = [
  /\b(tailor|ready|generate|prepare)\b/g,
  /\bthe resume\b/g,
  /\bresume\b/g,
  /\bfor\b/g,
  /\band send (it|that)?( ?to)?( my)?( telegram| linkedin)?( channel)?\b/g,
  /\bsend (it|that)?( ?to)?( my)?( telegram| linkedin)?( channel)?\b/g,
  /\btelegram( channel)?\b/g,
  /\blinkedin( channel)?\b/g,
  /\bplease\b/g,
  /\bnow\b/g,
  /\bright away\b/g,
];

// Single leftover glue words speech-to-text tends to mishear a nearby word
// into (e.g. "ready THE resume" heard as "ready TO resume" leaves "to"
// stuck to the front of the extracted company) — stripped as individual
// words on top of the phrase-level FILLER_PATTERNS above, which only match
// exact multi-word phrasing and miss this kind of one-off substitution.
const STOPWORDS = new Set(["to", "the", "a", "an", "it", "that", "of", "and", "my"]);

// Local fallback only — used when the Gemini-backed extraction below fails
// outright (no API key, network down). Regex pattern-matching a specific
// phrase shape is inherently brittle against real speech-to-text noise;
// this exists so the feature degrades instead of breaking entirely, not as
// the primary path.
function extractCompanyNameLocally(normalized: string): string | null {
  let cleaned = normalized;
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  const words = cleaned.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  return words.length > 0 ? words.join(" ") : null;
}

async function extractCompanyNameViaLLM(transcript: string): Promise<string | null> {
  try {
    const res = await fetch("/api/assistant/parse-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { company?: string | null };
    return typeof data.company === "string" && data.company.trim() ? data.company.trim() : null;
  } catch {
    return null;
  }
}

export async function parseCompanyResumeCommand(
  transcript: string,
): Promise<{ company: string; sendTelegram: boolean } | null> {
  const gate = detectCommand(transcript);
  if (!gate) return null;

  const company = (await extractCompanyNameViaLLM(transcript)) ?? extractCompanyNameLocally(transcript.trim().toLowerCase());
  if (!company) return null;
  return { company, sendTelegram: gate.sendTelegram };
}

async function searchJobs(search: string): Promise<DashboardJob[]> {
  const query = new URLSearchParams({ search, limit: "5" }).toString();
  const res = await fetch(`/api/dashboard/jobs?${query}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { jobs?: DashboardJob[] };
  return data.jobs ?? [];
}

export async function findJobByCompany(company: string): Promise<DashboardJob | null> {
  const words = company.split(" ").filter(Boolean);
  // Speech-to-text splits one-word company names into two ("Robinhood"
  // heard as "Robin Hood") often enough that the plain search misses a
  // real, visible-on-the-dashboard job entirely — the DB's `search` param
  // does a literal substring ilike, so "robin hood" never matches
  // "Robinhood". Try the transcript as heard first, then the words mashed
  // together with no space, then just the first word, stopping at the
  // first attempt that actually finds something.
  // A bare stopword (a leftover glue word the local regex fallback above
  // failed to strip) is too broad to search on at all — "%to%" would match
  // almost anything — so it's excluded as a single-word candidate rather
  // than risk surfacing a wrong job with high confidence, the exact
  // live-reproduced bug this guards against.
  const firstWordCandidate = words[0] && !STOPWORDS.has(words[0]) ? words[0] : null;
  const candidates = Array.from(new Set([company, words.join(""), firstWordCandidate].filter((c): c is string => !!c)));
  for (const candidate of candidates) {
    const jobs = await searchJobs(candidate);
    // Jobs come back newest-first; prefer one with an apply_url (should be
    // all of them, but link-resume needs it to do anything).
    const match = jobs.find((j) => !!j.apply_url);
    if (match) return match;
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
