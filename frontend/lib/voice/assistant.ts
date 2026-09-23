"use client";

// The single entry point the Siri-style UI calls with whatever it hears.
// Each capability is its own small "agent" module underneath — commands.ts
// (sign-out/mute/close), weather.ts, news.ts, qa.ts — tried in order; the
// first one that recognizes the transcript as its own kind of request wins.
// Anything nobody claims falls through to the general-knowledge Q&A agent.
import { parseVoiceCommand, parseWeatherQuery, parseNewsQuery } from "@/lib/voice/commands";
import { getWeather } from "@/lib/voice/weather";
import { getNews } from "@/lib/voice/news";
import { askQuestion } from "@/lib/voice/qa";
import { isJobStatusQuery, getJobStatus } from "@/lib/voice/jobStatus";
import {
  isNewTodayQuery,
  isAppliedCountQuery,
  isStrongMatchQuery,
  isResumesReadyQuery,
  getNewTodayAnswer,
  getAppliedCountAnswer,
  getStrongMatchAnswer,
  getResumesReadyAnswer,
} from "@/lib/voice/statsQueries";
import {
  isTopMatchQuery,
  isPendingQuery,
  parseDomainQuery,
  fetchTopMatch,
  fetchPending,
  fetchByDomain,
  buildTopMatchAnswer,
  buildPendingAnswer,
  buildDomainAnswer,
} from "@/lib/voice/jobFeed";
import { farewell } from "@/lib/voice/greeting";
import type { DashboardJob } from "@/lib/dashboard/types";

export interface AssistantContext {
  signOut: () => void;
  closeTab: () => void;
  showDashboard: () => void;
  hideDashboard: () => void;
}

export type AssistantOutcome =
  | { kind: "spoken"; text: string }
  | { kind: "muted" }
  // `after` runs once the message has finished being spoken (not before —
  // sign-out used to navigate away immediately, which cut speech synthesis
  // off mid-sentence and was why the "Good night, Mr. Tarun." farewell was
  // never actually heard in full).
  | { kind: "action"; message: string; after?: () => void }
  // "Read me my best match" — distinct from a plain "spoken" answer so the
  // caller (SiriOrb.tsx) can remember which job was just read aloud, making
  // a follow-up "mark that applied"/"reject that" possible. Other job-feed
  // queries (pending list, domain list) stay plain "spoken" — reading a
  // list doesn't leave an unambiguous "that" to act on.
  | { kind: "job-mentioned"; text: string; job: DashboardJob }
  // Same idea as "job-mentioned" but for a list read aloud (pending/domain
  // queries) — lets the caller (SiriOrb.tsx) remember the ordered jobs so a
  // follow-up "the third one"/"mark the second one applied" can resolve a
  // specific list item by position instead of only a single "that".
  | { kind: "jobs-mentioned"; text: string; jobs: DashboardJob[] }
  // Continuous listening picks up ambient noise/fragments too — a stray
  // one-word scrap that matches no real command shouldn't get sent to
  // Gemini and spoken back out loud as if it were a real answer (that's
  // exactly what reads as "randomly talking on its own"). "ignored" means
  // exactly that: say nothing, just go back to listening.
  | { kind: "ignored" };

// A single common filler word alone almost certainly isn't a real
// question — require at least two words before treating something as
// worth sending to the general Q&A agent (weather/news/commands all
// match on specific known phrases already, so they aren't at risk of
// this the same way).
function looksLikeNoise(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length < 2;
}

// Fixed, exact answer for "who/what are you"-type questions — not left to
// Gemini's judgment, since it doesn't actually know what SKYNET's pipeline
// does and would either guess generically or ramble. This is a real
// description of the Mark I-IV pipeline, not marketing copy.
const IDENTITY_PHRASES = ["who are you", "what are you", "what do you do", "who is skynet", "what is skynet"];
const IDENTITY_ANSWER =
  "Hi, I am SKYNET, Tarun's Silicon Valley job monitoring system. I search for jobs that best fit Tarun's " +
  "profile, review and score them, write and tailor his resume accordingly, and keep it ready so Tarun can " +
  "apply easily.";

function isIdentityQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return IDENTITY_PHRASES.some((phrase) => normalized.includes(phrase));
}

export async function handleTranscript(transcript: string, ctx: AssistantContext): Promise<AssistantOutcome> {
  if (isIdentityQuestion(transcript)) {
    return { kind: "spoken", text: IDENTITY_ANSWER };
  }

  const command = parseVoiceCommand(transcript);
  if (command === "mute") {
    return { kind: "muted" };
  }
  if (command === "sign-out") {
    // Deferred, not called here — the actual sign-out navigates away and
    // unmounts SKYNET, which would otherwise cut the farewell off partway
    // through. The caller runs `after` only once the message is fully spoken.
    return { kind: "action", message: farewell(), after: ctx.signOut };
  }
  if (command === "close") {
    ctx.closeTab();
    // Browsers only let a page close a tab it opened via script itself —
    // recognized correctly, just can't be carried out on a normal tab.
    return { kind: "action", message: "Can't close this tab automatically — your browser blocks that. Press Command W instead." };
  }
  if (command === "show-dashboard") {
    ctx.showDashboard();
    return { kind: "action", message: "Opening the dashboard." };
  }
  if (command === "hide-dashboard") {
    ctx.hideDashboard();
    return { kind: "action", message: "Hiding the dashboard." };
  }

  const weatherQuery = parseWeatherQuery(transcript);
  if (weatherQuery.isWeatherQuery) {
    return { kind: "spoken", text: await getWeather(weatherQuery.place) };
  }

  const newsQuery = parseNewsQuery(transcript);
  if (newsQuery.isNewsQuery) {
    return { kind: "spoken", text: await getNews(newsQuery.topic) };
  }

  if (isJobStatusQuery(transcript)) {
    return { kind: "spoken", text: await getJobStatus() };
  }

  // Specific stats queries — checked ahead of the general job-status
  // summary above only in the sense that they're independent phrase sets
  // (no overlap), all against the same live /api/dashboard/stats data.
  if (isNewTodayQuery(transcript)) {
    return { kind: "spoken", text: await getNewTodayAnswer() };
  }
  if (isAppliedCountQuery(transcript)) {
    return { kind: "spoken", text: await getAppliedCountAnswer() };
  }
  if (isStrongMatchQuery(transcript)) {
    return { kind: "spoken", text: await getStrongMatchAnswer() };
  }
  if (isResumesReadyQuery(transcript)) {
    return { kind: "spoken", text: await getResumesReadyAnswer() };
  }

  if (isTopMatchQuery(transcript)) {
    const job = await fetchTopMatch();
    const text = buildTopMatchAnswer(job);
    return job ? { kind: "job-mentioned", text, job } : { kind: "spoken", text };
  }
  if (isPendingQuery(transcript)) {
    const jobs = await fetchPending();
    const text = buildPendingAnswer(jobs);
    return jobs.length > 0 ? { kind: "jobs-mentioned", text, jobs } : { kind: "spoken", text };
  }
  const domainQuery = parseDomainQuery(transcript);
  if (domainQuery) {
    const jobs = await fetchByDomain(domainQuery);
    const text = buildDomainAnswer(jobs);
    return jobs.length > 0 ? { kind: "jobs-mentioned", text, jobs } : { kind: "spoken", text };
  }

  if (looksLikeNoise(transcript)) {
    return { kind: "ignored" };
  }

  return { kind: "spoken", text: await askQuestion(transcript) };
}
