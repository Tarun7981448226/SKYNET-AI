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

export function parseCompanyResumeCommand(transcript: string): { company: string; sendTelegram: boolean } | null {
  const normalized = transcript.trim().toLowerCase();
  // Let the "score the link I just copied" flow handle these instead —
  // it also matches /\btailor\b/, and a clipboard command never mentions
  // a company by name for this parser to extract anyway.
  if (/\b(clipboard|copied)\b/.test(normalized)) return null;
  if (!TRIGGER_WORDS.test(normalized) || !/\bresume\b/.test(normalized)) return null;

  const sendTelegram = DELIVER_WORDS.test(normalized);
  const company = extractCompanyName(normalized);
  if (!company) return null;
  return { company, sendTelegram };
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

function extractCompanyName(normalized: string): string | null {
  let cleaned = normalized;
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export async function findJobByCompany(company: string): Promise<DashboardJob | null> {
  const query = new URLSearchParams({ search: company, limit: "5" }).toString();
  const res = await fetch(`/api/dashboard/jobs?${query}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { jobs?: DashboardJob[] };
  const jobs = data.jobs ?? [];
  // Jobs come back newest-first; prefer one with an apply_url (should be
  // all of them, but link-resume needs it to do anything).
  return jobs.find((j) => !!j.apply_url) ?? null;
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
