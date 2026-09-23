"use client";

// The public landing page's dispatcher — deliberately a small subset of
// lib/voice/assistant.ts's authenticated capabilities. No job status, no
// dashboard show/hide, no sign-out (none of that makes sense pre-login,
// and job status is private data that must never be reachable by an
// anonymous visitor). Identity/weather/general-Q&A stay, but general Q&A
// goes through the separate, restricted, rate-limited /api/public/ask
// (lib/voice/publicQa.ts) rather than the dashboard's more open agent.
import { parseVoiceCommand, parseWeatherQuery } from "@/lib/voice/commands";
import { getWeather } from "@/lib/voice/weather";
import { askPublicQuestion } from "@/lib/voice/publicQa";

export interface PublicAssistantContext {
  showLogin: () => void;
  // How many real questions (identity/creator/weather/general Q&A — not
  // commands like "mute" or "sign in") this visitor has already had
  // answered this page load. The caller owns the count (a plain ref reset
  // by a page reload is exactly the "reload for ten more" behavior asked
  // for) and passes it in fresh on every call.
  questionsAskedSoFar: number;
}

// Per-page-load cap, independent of the server-side per-IP rate limit on
// /api/public/ask (that one guards against scripted abuse regardless of
// this client-side JS; this one is the visible, user-facing "you've asked
// enough for now" UX). Reloading the page resets it since the count lives
// only in the caller's component state.
const QUESTION_LIMIT = 10;
const LIMIT_REACHED_MESSAGE =
  "You've reached your limit of questions to SKYNET for this visit — reload the page for ten more.";

export type PublicAssistantOutcome =
  | { kind: "spoken"; text: string }
  | { kind: "muted" }
  | { kind: "action"; message: string; after?: () => void }
  | { kind: "ignored" }
  // "who are you" / "what do you do" — a real narrated walk-through
  // instead of one line, see components/public/SkynetPresentation.tsx.
  | { kind: "presentation" }
  // "who is Tarun" / "where is Tarun from" — a small bio card, distinct
  // from the "presentation" kind above which is about SKYNET itself; see
  // components/public/TarunBioPoster.tsx.
  | { kind: "bio"; spokenIntro: string }
  // "what can you do" / "super tasks" — the capabilities checklist card,
  // see components/public/SkynetCapabilities.tsx. Distinct from
  // "presentation" (a narrated story) — this is a quick factual rundown.
  | { kind: "capabilities" }
  // "all of the above" — runs presentation, capabilities, and bio one
  // after another; the caller (EvePublic.tsx) owns the actual sequencing.
  | { kind: "all-options" }
  // The word "hello" specifically (not bare "hi"/"hey") — starts (or
  // resumes) the name-and-options conversation; see isHelloGreeting below.
  // The caller decides exactly what to say based on whether it already
  // knows the visitor's name — this module only classifies the intent.
  | { kind: "hello" };

// Same "at least two words" noise filter as the authenticated assistant —
// see lib/voice/assistant.ts for the reasoning (continuous listening picks
// up ambient fragments that shouldn't get sent to Gemini and spoken back).
function looksLikeNoise(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length < 2;
}

// "Who are you" / "what do you do" now trigger the full narrated
// presentation (SkynetPresentation.tsx) rather than one line, per the
// explicit brief for detail here. "Who made you" stays a quick spoken
// answer — that one's not asking what SKYNET does.
const IDENTITY_PHRASES = ["who are you", "what are you", "what do you do", "who is skynet", "what is skynet"];

const CREATOR_PHRASES = ["who made you", "who built you", "who created you", "who's your creator", "whos your creator"];
const CREATOR_ANSWER = "Tarun built me, as his own personal project.";

// Questions about Tarun himself, not about SKYNET — kept as a distinct
// phrase list from IDENTITY_PHRASES/CREATOR_PHRASES above so "who are
// you" (about SKYNET) and "who is Tarun" (about the person) never get
// confused for each other.
const TARUN_PHRASES = [
  "who is tarun",
  "who's tarun",
  "whos tarun",
  "where is tarun from",
  "where's tarun from",
  "what does tarun do",
  "what is tarun doing",
  "tell me about tarun",
];
export const TARUN_BIO_SPOKEN_INTRO =
  "This is Tarun — an M.S. Computer Science student at the University of Southern California, and the person who built me.";

function isIdentityQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return IDENTITY_PHRASES.some((phrase) => normalized.includes(phrase));
}

function isCreatorQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return CREATOR_PHRASES.some((phrase) => normalized.includes(phrase));
}

function isTarunBioQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return TARUN_PHRASES.some((phrase) => normalized.includes(phrase));
}

// "What can you actually do" — distinct from isIdentityQuestion above,
// which triggers the narrated multi-slide story. This is the quick,
// factual checklist version (components/public/SkynetCapabilities.tsx).
const CAPABILITIES_PHRASES = [
  "what can you do",
  "what do you do for tarun",
  "what are your super tasks",
  "super tasks",
  "what tasks can you do",
  "what tasks do you do",
  "show me what you can do",
  "what are you capable of",
];

function isCapabilitiesQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return CAPABILITIES_PHRASES.some((phrase) => normalized.includes(phrase));
}

const ALL_OPTIONS_PHRASES = ["all of the above", "all of it", "show me everything", "everything please", "tell me everything"];

function isAllOptionsQuestion(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return ALL_OPTIONS_PHRASES.some((phrase) => normalized.includes(phrase));
}

// Friendly small talk — checked ahead of the noise filter below, since
// "hi"/"hello" alone are single words that filter would otherwise drop
// silently (that's part of why greetings went unanswered). Restricted to
// short utterances (<=3 words) so a longer sentence that happens to open
// with "hi" — "hi what's the weather" — still falls through to the real
// request instead of being swallowed as small talk.
//
// "hello" specifically (not the other greeting words) is EVE's cue to
// start the name-and-options conversation — per the explicit brief: a
// bare "hi" gets a bare "hello" back, but "hello" itself opens the real
// conversation ("hi, how are you, may I know your name?").
const GREETING_WORDS = ["hi", "hello", "hey", "hiya", "howdy", "yo", "greetings"];
const GREETING_REPLY = "Hello!";

function isGreeting(transcript: string): boolean {
  const words = transcript.trim().toLowerCase().replace(/[.,!?]+$/, "").split(/\s+/);
  return words.length <= 3 && GREETING_WORDS.includes(words[0]);
}

function isHelloGreeting(transcript: string): boolean {
  const words = transcript.trim().toLowerCase().replace(/[.,!?]+$/, "").split(/\s+/);
  return words.length <= 3 && words[0] === "hello";
}

// Wraps a real-question branch so it checks the per-session quota right
// before actually producing an answer — never called for commands
// (mute/sign-in still work after the quota's spent) or for noise
// (never worth spending a slot on).
async function withQuota(
  ctx: PublicAssistantContext,
  produce: () => PublicAssistantOutcome | Promise<PublicAssistantOutcome>,
): Promise<PublicAssistantOutcome> {
  if (ctx.questionsAskedSoFar >= QUESTION_LIMIT) {
    return { kind: "spoken", text: LIMIT_REACHED_MESSAGE };
  }
  return produce();
}

export async function handlePublicTranscript(
  transcript: string,
  ctx: PublicAssistantContext,
): Promise<PublicAssistantOutcome> {
  const command = parseVoiceCommand(transcript);
  if (command === "mute") {
    return { kind: "muted" };
  }
  if (command === "show-login") {
    return { kind: "action", message: "Here's the sign-in page.", after: ctx.showLogin };
  }

  if (isIdentityQuestion(transcript)) {
    return withQuota(ctx, () => ({ kind: "presentation" }));
  }
  if (isCreatorQuestion(transcript)) {
    return withQuota(ctx, () => ({ kind: "spoken", text: CREATOR_ANSWER }));
  }
  if (isTarunBioQuestion(transcript)) {
    return withQuota(ctx, () => ({ kind: "bio", spokenIntro: TARUN_BIO_SPOKEN_INTRO }));
  }
  if (isCapabilitiesQuestion(transcript)) {
    return withQuota(ctx, () => ({ kind: "capabilities" }));
  }
  if (isAllOptionsQuestion(transcript)) {
    return withQuota(ctx, () => ({ kind: "all-options" }));
  }
  if (isHelloGreeting(transcript)) {
    // Onboarding small talk, not a real question — doesn't spend a quota
    // slot, same as bare "hi"/mute/sign-in. EvePublic.tsx decides what to
    // actually say (first-time name ask vs. "hi again, {name}") since only
    // it knows whether a name's already been given this session.
    return { kind: "hello" };
  }
  if (isGreeting(transcript)) {
    // Small talk, not a real question against the assistant — doesn't
    // spend a slot of the session quota, same as mute/sign-in.
    return { kind: "spoken", text: GREETING_REPLY };
  }

  const weatherQuery = parseWeatherQuery(transcript);
  if (weatherQuery.isWeatherQuery) {
    return withQuota(ctx, async () => ({ kind: "spoken", text: await getWeather(weatherQuery.place) }));
  }

  if (looksLikeNoise(transcript)) {
    return { kind: "ignored" };
  }

  return withQuota(ctx, async () => ({ kind: "spoken", text: await askPublicQuestion(transcript) }));
}
