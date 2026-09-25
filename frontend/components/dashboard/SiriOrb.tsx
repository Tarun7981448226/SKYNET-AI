"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cancelSpeech, isSpeechSupported, speak } from "@/lib/voice/VoiceService";
import { handleTranscript } from "@/lib/voice/assistant";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { timeGreeting } from "@/lib/voice/greeting";
import { getMorningBriefing } from "@/lib/voice/morningBriefing";
import { ensurePushSubscription } from "@/lib/push/subscribe";
import { signOutRequest } from "@/lib/auth/signOut";
import { parseYesNo } from "@/lib/voice/yesNo";
import {
  parseDecisionCommand,
  parseOrdinal,
  parseOrdinalDecisionCommand,
  describeJob,
  postDecision,
  type DecisionWord,
} from "@/lib/voice/jobFeed";
import {
  isScoreClipboardCommand,
  extractUrl,
  submitLink,
  pollLinkResumeOnce,
  describeLinkResumeResult,
} from "@/lib/voice/clipboardLink";
import { parseCompanyResumeCommand, findJobByCompany, describeCompanyResumeResult } from "@/lib/voice/companyResume";
import { CaptionDisplay } from "@/components/dashboard/CaptionDisplay";
import { HologramOrb } from "@/components/dashboard/HologramOrb";
import { EveIntro } from "@/components/dashboard/EveIntro";
import type { DashboardJob } from "@/lib/dashboard/types";

function isWebglSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

// The heart/brain of the dashboard: one Siri-style orb replaces the old
// separate "play greeting" and "voice commands" buttons. It greets
// automatically on load with a real data-driven morning briefing (new jobs,
// good fits, pending/resumes-ready counts — lib/voice/morningBriefing.ts,
// fetched in parallel with EVE's intro animation so it's ready by the time
// she lands) instead of a plain time-of-day line. A single click toggles
// listening for anything — commands (sign out / mute / close), weather,
// news, job status, or any other question, all routed through
// lib/voice/assistant.ts.

type OrbState = "idle" | "speaking" | "listening" | "thinking" | "unsupported";

export function SiriOrb({
  onShowDashboard = () => {},
  onHideDashboard = () => {},
}: {
  onShowDashboard?: () => void;
  onHideDashboard?: () => void;
} = {}) {
  const router = useRouter();
  const [state, setState] = useState<OrbState>("idle");
  const [captionWords, setCaptionWords] = useState<string[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [captionVisible, setCaptionVisible] = useState(false);
  const captionHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionWordCountRef = useRef(0);
  const [heard, setHeard] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldListenRef = useRef(false);
  // Mirrors `state === "speaking"` but as a ref, since recognition.onresult
  // is set up once (inside an effect that doesn't depend on `state`) and
  // would otherwise always see the stale initial state via closure.
  const isSpeakingRef = useRef(false);
  const attemptedGreeting = useRef(false);
  // Guards against the same utterance getting processed twice in a row —
  // continuous SpeechRecognition can occasionally re-fire on the same
  // audio (a known quirk), which read as SKYNET "repeating things on its
  // own." Skips a transcript identical to the immediately-previous one
  // within this window.
  const lastProcessedRef = useRef<{ text: string; time: number } | null>(null);
  const DEDUP_WINDOW_MS = 4000;
  // The real fix for "hearing its own voice": isSpeakingRef alone isn't
  // enough, because speech recognition doesn't finalize instantly — there
  // can be a real lag between audio captured *while* SKYNET was talking
  // and the transcript actually arriving *after* it's already back to
  // listening. Two independent guards close that gap:
  //  1. A grace period after speech ends, during which incoming results
  //     are still treated as speaking-adjacent (mute-only).
  //  2. A content check: if the transcript closely overlaps what SKYNET
  //     itself just said, treat it as an echo regardless of timing.
  const speechEndTimeRef = useRef(0);
  const lastSpokenTextRef = useRef("");
  const SPEECH_GRACE_PERIOD_MS = 1500;

  // The job most recently read aloud ("read me my best match") — lets a
  // follow-up "mark that applied"/"reject that" resolve what "that" means.
  // A ref, not state: only read/written inside recognition.onresult.
  const lastMentionedJobRef = useRef<DashboardJob | null>(null);
  // Set right after a decision command is heard, cleared once the next
  // transcript answers yes/no (or is dropped as unrelated) — the same
  // "next transcript answers this question" shape as EvePublic.tsx's
  // ConversationFlow, scoped to just this one confirm step since it's the
  // only multi-turn flow SiriOrb needs.
  const pendingConfirmRef = useRef<{ job: DashboardJob; decision: DecisionWord } | null>(null);
  // The ordered list of jobs most recently read aloud ("what's still
  // pending", "any AI/ML jobs today") — lets a follow-up "the third one
  // down" / "mark the second one applied" resolve a specific list item by
  // position, the plural sibling of lastMentionedJobRef above.
  const lastMentionedJobListRef = useRef<DashboardJob[]>([]);
  // Tracks the in-flight "score the link I just copied" poll so a second
  // invocation replaces it instead of running two pollers at once.
  const linkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set the instant a click dismisses EVE's arrival — guards handleEveArrived
  // (which can still be mid-flight awaiting the briefing fetch) from
  // starting the greeting speech after the user already asked to skip it.
  const introSkippedRef = useRef(false);

  function isLikelySelfEcho(transcript: string): boolean {
    const spoken = lastSpokenTextRef.current.toLowerCase();
    if (!spoken) return false;
    const heardWords = transcript
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2); // skip short/filler words, too noisy to compare
    // A single short word overlapping her own recent speech is a coin
    // flip, not real evidence of an echo (e.g. a one-word reply that
    // happens to share a name/term with what she just said) — see
    // EvePublic.tsx's identical guard for the live-reproduced case this
    // fixes. Keeps this aimed at a longer sentence of hers leaking back
    // through the mic, the actual failure mode it exists for.
    if (heardWords.length < 2) return false;
    const overlap = heardWords.filter((w) => spoken.includes(w)).length;
    return overlap / heardWords.length > 0.6;
  }
  // Detected client-side only (useEffect, not a lazy useState initializer)
  // — Next.js server-renders this "use client" component's initial HTML
  // too, where `window` doesn't exist, so checking during render would
  // permanently bake in "unsupported" even in a browser that has WebGL.
  // Defaults to the safe fallback (CSS bars) until confirmed otherwise.
  const [webglSupported, setWebglSupported] = useState(false);
  // EVE (WALL-E's companion) flies in and hands off into the real orb on
  // load — see EveIntro.tsx. "enter"/"greet" are driven by EveIntro itself;
  // "depart" is set once the real greeting speech has actually finished
  // (not a fixed timer); "done" unmounts EveIntro and reveals the orb.
  const [introPhase, setIntroPhase] = useState<"enter" | "greet" | "depart" | "done">("enter");
  // Fires earlier than introPhase reaching "done" — right when EVE's jump
  // apex/burst happens, so the orb starts popping in while she's still
  // mid-fade (a real overlap) instead of waiting for her to fully vanish
  // first, which read as "disappears" rather than "becomes the orb."
  const [orbPoppedIn, setOrbPoppedIn] = useState(false);
  const orbWrapRef = useRef<HTMLDivElement>(null);
  const greetingTextRef = useRef(timeGreeting());
  // Kicked off at mount (see the attemptedGreeting effect below), in
  // parallel with EVE's ~1.7s fly-in — resolves to a real data-driven
  // briefing (new jobs, good fits, pending/resumes-ready counts) that
  // replaces the plain greetingTextRef fallback once EVE lands, normally
  // well before handleEveArrived even needs it.
  const briefingPromiseRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    const Ctor =
      typeof window !== "undefined" ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined;
    if (!Ctor) {
      // Recognition isn't supported — the orb can still speak (greeting,
      // and future answers) even without a mic, so only bail out entirely
      // if speech synthesis is unsupported too.
      if (!isSpeechSupported()) setState("unsupported");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = async (event) => {
      const transcript = event.results[event.results.length - 1][0]?.transcript ?? "";

      const withinGracePeriod = Date.now() - speechEndTimeRef.current < SPEECH_GRACE_PERIOD_MS;
      if (isSpeakingRef.current || withinGracePeriod) {
        // The mic stays on even while SKYNET is talking so a real "mute" /
        // "stop" / "pause" can interrupt it — but anything else heard here
        // is most likely the mic picking up SKYNET's own voice, not a new
        // request, so only an interrupt command is acted on; everything
        // else is ignored rather than risking a feedback loop into
        // weather/news/Q&A re-triggering off its own speech. The grace
        // period (not just the live isSpeakingRef flag) covers late
        // transcripts of audio captured while still speaking that only
        // finalize after speech already ended. (One real edge case
        // neither guard avoids: if the spoken answer itself contains a
        // word like "stop", that could self-interrupt.)
        if (parseVoiceCommand(transcript) === "mute") {
          cancelSpeech();
          finishSpeaking({ muted: true });
        }
        return;
      }

      if (isLikelySelfEcho(transcript)) {
        // Outside the timing window too, but still closely matches what
        // was just said — a delayed echo the grace period alone missed.
        return;
      }

      const normalized = transcript.trim().toLowerCase();
      const last = lastProcessedRef.current;
      if (last && last.text === normalized && Date.now() - last.time < DEDUP_WINDOW_MS) {
        return;
      }
      lastProcessedRef.current = { text: normalized, time: Date.now() };

      setHeard(transcript);

      // Mid-conversation states bypass normal dispatch entirely — same
      // shape as EvePublic.tsx's ConversationFlow checks, scoped here to
      // just the one pending decision-confirmation.
      if (pendingConfirmRef.current) {
        const pending = pendingConfirmRef.current;
        pendingConfirmRef.current = null;
        const answer = parseYesNo(transcript);
        if (answer === "yes") {
          setState("thinking");
          const ok = await postDecision(pending.job.id, pending.decision);
          speakText(ok ? `Marked ${pending.decision}.` : "Sorry, that didn't go through — try again.");
          return;
        }
        if (answer === "no") {
          speakText("Okay, no changes.");
          return;
        }
        // Neither a clear yes nor no — drop the pending confirmation
        // silently and let this transcript fall through to normal
        // dispatch below, so an unrelated follow-up isn't stuck.
      }

      // Ordinal checks are gated on a list actually having been read aloud
      // — "first"/"second"/"third" are common English words, so without
      // this guard an unrelated question ("what's the second largest
      // planet") right after some other exchange could get misread as a
      // job command. Checked ahead of the single-referent "that/it" check
      // below since the two never overlap (an ordinal transcript has no
      // "that"/"it", and vice versa) but conceptually belong together.
      if (lastMentionedJobListRef.current.length > 0) {
        const ordinalDecision = parseOrdinalDecisionCommand(transcript);
        if (ordinalDecision) {
          const job = lastMentionedJobListRef.current[ordinalDecision.ordinal - 1];
          if (!job) {
            speakText(`I only read out ${lastMentionedJobListRef.current.length} jobs.`);
          } else {
            askDecisionConfirmation(job, ordinalDecision.decision);
          }
          return;
        }

        const ordinal = parseOrdinal(transcript);
        if (ordinal) {
          const job = lastMentionedJobListRef.current[ordinal - 1];
          if (!job) {
            speakText(`I only read out ${lastMentionedJobListRef.current.length} jobs.`);
          } else {
            // Selecting by position sets the same single-job referent a
            // direct read-aloud would ("read me my best match") — a
            // follow-up "mark that applied" then works the normal way.
            lastMentionedJobRef.current = job;
            speakText(`That's ${describeJob(job)}.`);
          }
          return;
        }
      }

      const decision = parseDecisionCommand(transcript);
      if (decision) {
        const job = lastMentionedJobRef.current;
        if (!job) {
          speakText("Ask me to read a job first so I know which one you mean.");
        } else {
          askDecisionConfirmation(job, decision);
        }
        return;
      }

      // Checked ahead of the clipboard-link command below since both can
      // match on the bare word "tailor" — a company-name command always
      // wins when it successfully extracts a company, since a clipboard
      // command never names one.
      const companyResumeCommand = parseCompanyResumeCommand(transcript);
      if (companyResumeCommand) {
        await handleCompanyResumeCommand(companyResumeCommand.company, companyResumeCommand.sendTelegram);
        return;
      }

      if (isScoreClipboardCommand(transcript)) {
        await handleScoreClipboardCommand();
        return;
      }

      setState("thinking");

      const outcome = await handleTranscript(transcript, {
        signOut: () => {
          signOutRequest().finally(() => {
            router.push("/login");
            router.refresh();
          });
        },
        closeTab: () => window.close(),
        showDashboard: onShowDashboard,
        hideDashboard: onHideDashboard,
      });

      if (outcome.kind === "muted") {
        cancelSpeech();
        setState(shouldListenRef.current ? "listening" : "idle");
      } else if (outcome.kind === "ignored") {
        setState(shouldListenRef.current ? "listening" : "idle");
      } else if (outcome.kind === "action") {
        speakText(outcome.message, outcome.after);
      } else if (outcome.kind === "job-mentioned") {
        lastMentionedJobRef.current = outcome.job;
        speakText(outcome.text);
      } else if (outcome.kind === "jobs-mentioned") {
        lastMentionedJobListRef.current = outcome.jobs;
        speakText(outcome.text);
      } else {
        speakText(outcome.text);
      }
    };

    recognition.onend = () => {
      // continuous mode can still stop itself (e.g. a silence timeout) —
      // restart automatically while the user still has it toggled on.
      // Wrapped because stop()/onend don't always finish tearing the
      // browser's internal session down synchronously — a start() call
      // landing in that gap throws "already started" even though that's
      // exactly the state we want, so it's safe to just ignore.
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // Already running — fine.
        }
      }
    };

    // Without this, a denied mic permission (or no microphone at all)
    // failed completely silently: the orb stayed in "listening" state
    // forever, onend kept retrying start() and immediately failing again,
    // and nothing ever told the user why nothing was happening — same
    // fix as EvePublic.tsx's identical guard, see there for the
    // live-reported case this addresses. Speech synthesis doesn't need
    // mic access, so it can still say what's wrong.
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setState("idle");
        speakText("I can't hear you — this site needs microphone access. Check your browser's site settings, then click me again.");
      } else if (event.error === "audio-capture") {
        shouldListenRef.current = false;
        setState("idle");
        speakText("I can't find a microphone on this device.");
      } else if (event.error === "network") {
        // Web Speech recognition sends audio to a remote service even
        // though it feels local — a blocked/unstable connection (venue
        // wifi, VPN, firewall) fails here with no other symptom at all:
        // the orb just sits "listening" forever, never transcribing
        // anything, and onend's auto-restart below would otherwise retry
        // into the same wall silently on every timeout. Live-reported as
        // "the orb is red and not responding" with zero feedback —
        // surface it instead of failing invisibly.
        shouldListenRef.current = false;
        setState("idle");
        speakText("I'm having trouble reaching the speech service — check your internet connection and click me to try again.");
      } else {
        // "no-speech"/"aborted" and similar are expected/benign in
        // continuous mode (a silence timeout, a legitimate stop() call) —
        // onend's own restart logic below already recovers from these.
        // Still logged so a genuinely new silent-failure mode leaves a
        // trace in the console next time instead of none at all.
        console.warn("SpeechRecognition error:", event.error);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {
        // Already stopped — fine.
      }
      if (linkPollRef.current) clearInterval(linkPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    setWebglSupported(isWebglSupported());
  }, []);

  // A click anywhere on the page while EVE is still flying in / talking
  // through the arrival greeting cuts it short: stop the reading right
  // there and send her straight to the orb's spot to become it, instead of
  // making the visitor sit through the whole briefing every load. Only
  // live during "enter"/"greet" — once she's departing or already handed
  // off to the real orb, a normal click should do whatever it normally
  // does (e.g. the orb's own click-to-listen).
  useEffect(() => {
    if (introPhase !== "enter" && introPhase !== "greet") return;
    function handleGlobalClick() {
      skipEveGreeting();
    }
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introPhase]);

  useEffect(() => {
    if (attemptedGreeting.current) return;
    attemptedGreeting.current = true;
    if (!isSpeechSupported()) {
      setState("unsupported");
      setIntroPhase("done");
      return;
    }
    briefingPromiseRef.current = getMorningBriefing(timeGreeting());
    // The actual greeting speech is triggered by handleEveArrived below,
    // once EVE has visibly landed — not immediately on mount.
    return () => cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Score the link I just copied" — reads the clipboard instead of asking
  // the visitor to say a URL out loud (speech recognition transcribes URLs
  // badly), submits it through the same pipeline LinkResumePanel.tsx's
  // manual paste box uses, then polls in the background and speaks the
  // result later, unprompted by any new transcript — the mic stays on and
  // keeps handling other requests normally while this runs.
  async function handleScoreClipboardCommand() {
    setState("thinking");
    let clipText = "";
    try {
      clipText = await navigator.clipboard.readText();
    } catch {
      // Permission denied/unavailable — reported the same as "no URL found"
      // below, since either way there's nothing to score.
    }
    const url = extractUrl(clipText);
    if (!url) {
      speakText("I didn't find a job link on your clipboard — copy the posting URL first.");
      return;
    }
    const result = await submitLink(url);
    if ("error" in result) {
      speakText(result.error);
      return;
    }
    const requestId = result.requestId;
    speakText("Got it — reading that link and tailoring your resume now. I'll let you know when it's ready.");
    if (linkPollRef.current) clearInterval(linkPollRef.current);
    linkPollRef.current = setInterval(async () => {
      const status = await pollLinkResumeOnce(requestId);
      if (status && status.status !== "pending") {
        if (linkPollRef.current) clearInterval(linkPollRef.current);
        linkPollRef.current = null;
        speakText(describeLinkResumeResult(status));
      }
    }, 3000);
  }

  // "Tailor the resume for Stripe" / "ready the resume for Stripe and send
  // it to my telegram" — looks the job up by company name (must already be
  // on the dashboard, ingested by a source adapter or a prior link-resume
  // run) and fires the same on-demand pipeline the paste-a-link box uses,
  // with sendTelegram controlling whether it also delivers to Telegram or
  // just lands tailored in the pending dashboard.
  async function handleCompanyResumeCommand(company: string, sendTelegram: boolean) {
    setState("thinking");
    const job = await findJobByCompany(company);
    if (!job || !job.apply_url) {
      speakText(`I couldn't find a job from ${company} in the pipeline yet.`);
      return;
    }
    const result = await submitLink(job.apply_url, sendTelegram);
    if ("error" in result) {
      speakText(result.error);
      return;
    }
    const requestId = result.requestId;
    speakText(
      sendTelegram
        ? `Found it — tailoring the ${job.company} resume and sending it to your Telegram now.`
        : `Found it — tailoring the ${job.company} resume now.`,
    );
    if (linkPollRef.current) clearInterval(linkPollRef.current);
    linkPollRef.current = setInterval(async () => {
      const status = await pollLinkResumeOnce(requestId);
      if (status && status.status !== "pending") {
        if (linkPollRef.current) clearInterval(linkPollRef.current);
        linkPollRef.current = null;
        speakText(describeCompanyResumeResult(status, sendTelegram, job.company));
      }
    }, 3000);
  }

  // Shared by both the single-referent ("mark that applied") and the
  // ordinal ("mark the third one applied") decision flows — deliberately
  // phrased as a plain yes/no question rather than "say yes to confirm":
  // that instruction would put the literal word "yes" in what she just
  // said, and the self-echo guard above (isLikelySelfEcho) would then
  // treat the visitor's own "yes" reply as an echo of her prompt and
  // silently drop it. Live-verified: reproduced and fixed during testing.
  function askDecisionConfirmation(job: DashboardJob, decision: DecisionWord) {
    pendingConfirmRef.current = { job, decision };
    speakText(`Do you want to mark ${describeJob(job)} as ${decision}?`);
  }

  async function handleEveArrived() {
    // In the normal case this resolves instantly — the fetch has been
    // running in parallel with EVE's whole flight — so this only adds
    // real latency on an unusually slow network, never on a healthy one.
    greetingTextRef.current = await (briefingPromiseRef.current ?? Promise.resolve(greetingTextRef.current));
    // A click could have dismissed her while this await was still in
    // flight — don't start the greeting speech after the fact.
    if (introSkippedRef.current) return;
    setIntroPhase("greet");
    speakText(greetingTextRef.current, () => setIntroPhase("depart"));
  }

  function handleEveTransformStart() {
    setOrbPoppedIn(true);
  }

  function handleEveDeparted() {
    setIntroPhase("done");
  }

  // Click-anywhere dismissal of the arrival greeting (see the effect
  // above). Same cancel+finishSpeaking pattern handleOrbClick already uses
  // to mute mid-sentence — jumping straight to "depart" is what sends her
  // flying to the orb's spot and popping into it (EveIntro's depart effect
  // cancels her still-running enter flight first if she was dismissed
  // before even landing).
  function skipEveGreeting() {
    if (introSkippedRef.current || introPhase === "depart" || introPhase === "done") return;
    introSkippedRef.current = true;
    cancelSpeech();
    if (isSpeakingRef.current) {
      finishSpeaking({ muted: true });
    }
    setIntroPhase("depart");
  }

  function speakText(text: string, onComplete?: () => void) {
    if (captionHideTimeoutRef.current) clearTimeout(captionHideTimeoutRef.current);
    const words = text.split(" ");
    isSpeakingRef.current = true;
    lastSpokenTextRef.current = text;
    captionWordCountRef.current = words.length;
    setState("speaking");
    setCaptionWords(words);
    setActiveWordIndex(-1);
    setCaptionVisible(true);
    speak(text, { onWordBoundary: setActiveWordIndex })
      .then(() => finishSpeaking())
      .catch(() => finishSpeaking())
      // Runs after speech genuinely finishes (or is cut short by mute) —
      // never before, so an action like sign-out can't navigate away and
      // unmount SKYNET mid-sentence.
      .finally(() => onComplete?.());
  }

  function finishSpeaking(options?: { muted?: boolean }) {
    isSpeakingRef.current = false;
    speechEndTimeRef.current = Date.now();
    if (options?.muted) {
      // Cutting the audio doesn't need to cut the reading too — reveal
      // the rest of the line immediately so it can still be read even
      // though it stopped being spoken, instead of freezing mid-sentence.
      // captionWordCountRef (not React state) avoids a stale-closure read
      // here, since this can run well after the render that defined it.
      setActiveWordIndex(captionWordCountRef.current - 1);
    }
    setState(shouldListenRef.current ? "listening" : "idle");
    if (captionHideTimeoutRef.current) clearTimeout(captionHideTimeoutRef.current);
    captionHideTimeoutRef.current = setTimeout(() => setCaptionVisible(false), options?.muted ? 3000 : 1200);
  }

  function handleOrbClick() {
    if (state === "speaking") {
      cancelSpeech();
      finishSpeaking({ muted: true });
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (shouldListenRef.current) {
      shouldListenRef.current = false;
      recognition.stop();
      setState("idle");
    } else {
      // Fire-and-forget — this click is the one real user gesture the
      // dashboard has, needed since Notification.requestPermission()
      // won't reliably prompt outside a trusted-gesture context. No new
      // UI: matches the dashboard's "no visible chrome" design, and
      // early-returns immediately on every click after the first once
      // already subscribed.
      void ensurePushSubscription();
      shouldListenRef.current = true;
      setHeard("");
      recognition.start();
      setState("listening");
    }
  }

  if (state === "unsupported") {
    return null;
  }

  const label =
    state === "speaking"
      ? "Mute SKYNET"
      : state === "listening"
        ? "Stop listening"
        : state === "thinking"
          ? "Thinking…"
          : "Talk to SKYNET";

  const isActive = state !== "idle";

  return (
    <div className="flex flex-col items-center gap-2">
      {introPhase !== "done" && (
        <EveIntro
          phase={introPhase as "enter" | "greet" | "depart"}
          greetingText={greetingTextRef.current}
          targetRef={orbWrapRef}
          onArrived={handleEveArrived}
          onTransformStart={handleEveTransformStart}
          onDeparted={handleEveDeparted}
        />
      )}
      <div
        ref={orbWrapRef}
        style={{
          transform: `scale(${(isActive ? 1.5 : 1) * (orbPoppedIn ? 1 : 0.3)})`,
          opacity: orbPoppedIn ? 1 : 0,
          pointerEvents: orbPoppedIn ? "auto" : "none",
          transition: "transform 380ms cubic-bezier(.2,.7,.3,1), opacity 320ms ease",
        }}
      >
        {webglSupported ? (
          <HologramOrb state={state} onClick={handleOrbClick} label={label} size={84} />
        ) : (
          <button
            type="button"
            onClick={handleOrbClick}
            aria-label={label}
            className={`siri-orb siri-orb--${state}`}
          >
            <span className="siri-orb__bar" />
            <span className="siri-orb__bar" />
            <span className="siri-orb__bar" />
            <span className="siri-orb__bar" />
            <span className="siri-orb__bar" />
          </button>
        )}
      </div>
      {introPhase === "done" && captionVisible && <CaptionDisplay words={captionWords} activeIndex={activeWordIndex} />}
      {introPhase === "done" && state === "listening" && heard && (
        <span className="max-w-xs text-xs text-[var(--foreground)]/50">Heard: &ldquo;{heard}&rdquo;</span>
      )}
    </div>
  );
}
