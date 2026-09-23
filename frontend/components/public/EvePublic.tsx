"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cancelSpeech, isSpeechSupported, speak } from "@/lib/voice/VoiceService";
import { handlePublicTranscript, TARUN_BIO_SPOKEN_INTRO } from "@/lib/voice/publicAssistant";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { parseYesNo } from "@/lib/voice/yesNo";
import { CaptionDisplay } from "@/components/dashboard/CaptionDisplay";
import { SkynetPresentation } from "@/components/public/SkynetPresentation";
import { TarunBioPoster } from "@/components/public/TarunBioPoster";
import { SkynetCapabilities, CAPABILITIES_SPOKEN_INTRO } from "@/components/public/SkynetCapabilities";
import { EveOptionsCarousel, type EveOptionId } from "@/components/public/EveOptionsCarousel";
import { SkynetBot } from "@/components/character/SkynetBot";
import { Eve3D, type EveExpression } from "@/components/character/Eve3D";

function isWebglSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

// EVE herself, permanently, as the public landing page's whole assistant
// — no hand-off to a different-looking orb (that only happens on the
// authenticated /dashboard, which keeps its existing behavior). She flies
// in once, greets any visitor with a generic (never "Mr. Tarun" — this
// page doesn't know who's looking) welcome explaining what she can do,
// then stays in place as the click-to-talk character. Her own state
// (idle/listening/speaking/thinking) is shown through her eye glow color
// and the caption row rather than a separate visual component.
const PUBLIC_GREETING = "Hi, I'm SKYNET — Tarun's personal AI job assistant. How may I call you?";

type EveState = "idle" | "speaking" | "listening" | "thinking" | "unsupported";

// A conversational overlay, one step at a time, on top of the plain
// idle/listening/speaking state above:
// - "awaiting-name": her question was "how may I call you" / "may I know
//   your name" — the *next* transcript heard is taken as the name as-is,
//   not run through handlePublicTranscript's intent parsing.
// - "awaiting-more-info": her question was "would you like to know more
//   about me" — the next transcript is read as yes/no.
// A ref, not state: only read inside recognition.onresult and the flow's
// own handlers, all of which also trigger a state update (speakText/
// setOverlay) around the same time, so a stale read is never observed.
type ConversationFlow = "idle" | "awaiting-name" | "awaiting-more-info";

export function EvePublic({ onShowLogin }: { onShowLogin?: () => void } = {}) {
  const router = useRouter();
  const [state, setState] = useState<EveState>("idle");
  const [arrived, setArrived] = useState(false);
  // Client-only (useEffect, not a lazy useState initializer) — SSR's
  // initial HTML has no WebGL, so checking during render would
  // permanently bake in "unsupported" even in a browser that has it.
  // Falls back to the flat SVG (SkynetBot) when the real 3D model
  // (Eve3D, Tarun's own Eva.blend export) can't render.
  const [webglSupported, setWebglSupported] = useState(false);
  useEffect(() => {
    setWebglSupported(isWebglSupported());
  }, []);
  // "Who are you"/"what do you do" (the full narrated presentation),
  // "who is Tarun" (a small bio card), "what can you do" (the capabilities
  // checklist), and the post-name options carousel all slide her aside and
  // open a panel in the freed space, rather than answering with one line.
  // Only the presentation needs the mic paused (see presentingRef below) —
  // everything else here is a single short spoken line, already covered by
  // the normal grace-period echo guard.
  const [overlay, setOverlay] = useState<"none" | "presentation" | "bio" | "capabilities" | "options">("none");
  // "All of the above" queues the remaining two panels (presentation opens
  // immediately, then this drives what opens next each time the current
  // one closes) — see closeOverlay/activateOption below.
  const queueRef = useRef<Array<"presentation" | "bio" | "capabilities">>([]);
  // True for the whole "all of the above" sequence (set in activateOption,
  // cleared once the queue actually empties in closeOverlay) — lets
  // openOverlayItem tell whether bio/capabilities should auto-advance once
  // their intro finishes speaking, or wait for a manual Close like they do
  // when picked individually. Without this, "give me the whole tour"
  // stopped being hands-off after the presentation: bio and capabilities
  // never auto-advanced, and the mic was off too (see openOverlayItem's
  // comment), so the only way forward was finding and clicking each
  // panel's own Close button.
  const isTouringRef = useRef(false);
  const flowRef = useRef<ConversationFlow>("idle");
  // The visitor's given name, once she's asked and heard it — a ref, not
  // state, since it's only ever read inside handlers (never rendered
  // directly), same reasoning as questionCountRef below.
  const visitorNameRef = useRef<string | null>(null);
  const [captionWords, setCaptionWords] = useState<string[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [captionVisible, setCaptionVisible] = useState(false);
  // Per-page-load question quota (lib/voice/publicAssistant.ts) — a plain
  // ref, not state, since only handlePublicTranscript ever reads it and a
  // re-render isn't needed when it changes; resets naturally on reload.
  const questionCountRef = useRef(0);
  const captionHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionWordCountRef = useRef(0);
  const [heard, setHeard] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const armLeftRef = useRef<SVGGElement>(null);
  const armRightRef = useRef<SVGGElement>(null);
  const flutterActive = useRef(true);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldListenRef = useRef(false);
  const isSpeakingRef = useRef(false);
  // The presentation calls VoiceService's speak() directly (its own
  // multi-slide narration doesn't fit the single-utterance grace-period
  // echo guard below), which means isSpeakingRef/lastSpokenTextRef never
  // reflect what it's saying — the mic would otherwise hear her own
  // narration and misfire on it ("listening to its own sounds"). Recognition
  // is fully paused for the presentation's duration instead, tracked here
  // (a ref, not state, since only recognition.onend — outside React's
  // render cycle — reads it) so onend's auto-restart doesn't fight the
  // pause, and resumed afterward only if it was actually on before.
  const presentingRef = useRef(false);
  const wasListeningRef = useRef(false);
  const attemptedGreeting = useRef(false);
  const lastProcessedRef = useRef<{ text: string; time: number } | null>(null);
  const DEDUP_WINDOW_MS = 4000;
  const speechEndTimeRef = useRef(0);
  const lastSpokenTextRef = useRef("");
  const SPEECH_GRACE_PERIOD_MS = 1500;

  // Same self-echo guard as SiriOrb.tsx — see there for the full story on
  // why a timing flag alone isn't enough (recognition doesn't finalize
  // instantly).
  function isLikelySelfEcho(transcript: string): boolean {
    const spoken = lastSpokenTextRef.current.toLowerCase();
    if (!spoken) return false;
    const heardWords = transcript
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    // A single short word overlapping her own recent speech is a coin
    // flip, not real evidence of an echo — live-reproduced: a visitor
    // saying "Tarun" as their name got silently dropped here, since
    // "Tarun" is a literal substring of "Tarun's" in her own greeting
    // ("...Tarun's personal AI job assistant..."). Requiring at least 2
    // overlapping words keeps this guard aimed at what it's actually for
    // (a longer sentence of hers leaking back through the mic), not at
    // one-word replies that happen to share a name/term with her prompt.
    if (heardWords.length < 2) return false;
    const overlap = heardWords.filter((w) => spoken.includes(w)).length;
    return overlap / heardWords.length > 0.6;
  }

  // Fly in from off-screen left to her resting spot, once, on mount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.left = "-15vw";
    root.style.top = "50%";
    const h = root.animate([{ left: "-15vw", top: "50%" }, { left: "50%", top: "50%" }], {
      duration: 1600,
      easing: "cubic-bezier(.35,.05,.25,1)",
      fill: "forwards",
    });
    h.onfinish = () => setArrived(true);
    return () => h.cancel();
  }, []);

  // Slides to the opposite side of whichever panel is open — right for
  // the presentation and capabilities checklist (panels open on the
  // left), left for the bio card and the options carousel (panels open
  // on the right) — back to center once it closes. Only after she's
  // actually landed from the initial fly-in.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !arrived) return;
    const targetLeft =
      overlay === "presentation" || overlay === "capabilities" ? "82vw" : overlay === "bio" || overlay === "options" ? "18vw" : "50%";
    const h = root.animate([{ left: getComputedStyle(root).left }, { left: targetLeft }], {
      duration: 900,
      easing: "cubic-bezier(.35,.05,.25,1)",
      fill: "forwards",
    });
    return () => h.cancel();
  }, [overlay, arrived]);

  // Continuous arm flutter for as long as she's on screen.
  useEffect(() => {
    flutterActive.current = true;
    function left() {
      if (!flutterActive.current || !armLeftRef.current) return;
      armLeftRef.current.animate(
        [{ transform: "rotate(-8deg)" }, { transform: "rotate(-26deg)" }, { transform: "rotate(-8deg)" }],
        { duration: 620, easing: "ease-in-out" },
      ).onfinish = left;
    }
    function right() {
      if (!flutterActive.current || !armRightRef.current) return;
      setTimeout(() => {
        if (!flutterActive.current || !armRightRef.current) return;
        armRightRef.current.animate(
          [{ transform: "rotate(8deg)" }, { transform: "rotate(26deg)" }, { transform: "rotate(8deg)" }],
          { duration: 620, easing: "ease-in-out" },
        ).onfinish = right;
      }, 250);
    }
    left();
    right();
    return () => {
      flutterActive.current = false;
    };
  }, []);

  // Idle hover bob, always running.
  useEffect(() => {
    let active = true;
    const el = innerRef.current;
    if (!el) return;
    function loop() {
      if (!active || !el) return;
      el.animate(
        [
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
          { transform: "translate(-50%,-50%) translateY(-8px) rotate(-1.5deg)" },
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
          { transform: "translate(-50%,-50%) translateY(6px) rotate(1.5deg)" },
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
        ],
        { duration: 2400, easing: "ease-in-out" },
      ).onfinish = loop;
    }
    loop();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const Ctor =
      typeof window !== "undefined" ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined;
    if (!Ctor) {
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
        if (parseVoiceCommand(transcript) === "mute") {
          cancelSpeech();
          finishSpeaking({ muted: true });
        }
        return;
      }

      if (isLikelySelfEcho(transcript)) return;

      const normalized = transcript.trim().toLowerCase();
      const last = lastProcessedRef.current;
      if (last && last.text === normalized && Date.now() - last.time < DEDUP_WINDOW_MS) {
        return;
      }
      lastProcessedRef.current = { text: normalized, time: Date.now() };

      setHeard(transcript);

      // Mid-conversation states bypass intent parsing entirely — whatever
      // she just asked for (a name, a yes/no) is what this transcript is,
      // not something to run through handlePublicTranscript.
      if (flowRef.current === "awaiting-name") {
        handleNameCaptured(transcript);
        return;
      }
      if (flowRef.current === "awaiting-more-info") {
        handleMoreInfoAnswer(transcript);
        return;
      }

      setState("thinking");

      const outcome = await handlePublicTranscript(transcript, {
        showLogin: onShowLogin ?? (() => router.push("/login")),
        questionsAskedSoFar: questionCountRef.current,
      });

      if (outcome.kind === "muted") {
        cancelSpeech();
        setState(shouldListenRef.current ? "listening" : "idle");
      } else if (outcome.kind === "ignored") {
        setState(shouldListenRef.current ? "listening" : "idle");
      } else if (outcome.kind === "action") {
        speakText(outcome.message, outcome.after);
      } else if (outcome.kind === "presentation") {
        activateOption("presentation");
      } else if (outcome.kind === "bio") {
        activateOption("bio");
      } else if (outcome.kind === "capabilities") {
        activateOption("capabilities");
      } else if (outcome.kind === "all-options") {
        activateOption("all");
      } else if (outcome.kind === "hello") {
        handleHello();
      } else {
        // Only "spoken" outcomes count against the quota — commands
        // (handled above) and ignored noise never reach here.
        questionCountRef.current += 1;
        speakText(outcome.text);
      }
    };

    recognition.onend = () => {
      // continuous mode can still stop itself (e.g. a silence timeout) —
      // restart automatically while still meant to be listening. Wrapped
      // because stop()/onend don't always finish tearing the browser's
      // internal session down synchronously — a start() call landing in
      // that gap throws "already started" even though that's exactly the
      // state we want, so it's safe to just ignore.
      if (shouldListenRef.current && !presentingRef.current) {
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
    // and nothing ever told the visitor why nothing was happening —
    // reported live as "SKYNET isn't responding." Speech synthesis
    // doesn't need mic access, so she can still say what's wrong.
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setState("idle");
        speakText("I can't hear you — this site needs microphone access. Check your browser's site settings, then click me again.");
      } else if (event.error === "audio-capture") {
        shouldListenRef.current = false;
        setState("idle");
        speakText("I can't find a microphone on this device.");
      }
      // Other errors ("no-speech", "aborted", "network") are expected/
      // transient in continuous listening mode — onend's own auto-restart
      // already handles them without needing to say anything.
    };

    recognitionRef.current = recognition;
    return () => {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {
        // Already stopped — fine.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!arrived || attemptedGreeting.current) return;
    attemptedGreeting.current = true;
    if (!isSpeechSupported()) {
      setState("unsupported");
      return;
    }
    // The arrival greeting itself ends by asking her name — a streamlined
    // version of the general "hello" flow below (no separate "how are
    // you" preamble, since she's already introducing herself for the
    // first time here).
    flowRef.current = "awaiting-name";
    speakText(PUBLIC_GREETING, startListening);
    return () => cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

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
      .finally(() => onComplete?.());
  }

  function finishSpeaking(options?: { muted?: boolean }) {
    isSpeakingRef.current = false;
    speechEndTimeRef.current = Date.now();
    if (options?.muted) {
      setActiveWordIndex(captionWordCountRef.current - 1);
    }
    setState(shouldListenRef.current ? "listening" : "idle");
    if (captionHideTimeoutRef.current) clearTimeout(captionHideTimeoutRef.current);
    captionHideTimeoutRef.current = setTimeout(() => setCaptionVisible(false), options?.muted ? 3000 : 1200);
  }

  // Starts listening the same way handleClick's "start" branch does — used
  // as speakText's onComplete for every flow prompt that expects an
  // immediate spoken answer (the name ask, the more-info yes/no ask), so
  // the visitor doesn't have to manually click the character just to
  // answer a question she just asked them.
  function startListening() {
    const recognition = recognitionRef.current;
    if (!recognition || shouldListenRef.current) return;
    shouldListenRef.current = true;
    setHeard("");
    try {
      recognition.start();
    } catch {
      // Already running — fine.
    }
    setState("listening");
  }

  // Common framings recognition actually returns for a spoken name ("you
  // can call me Kaushik", "please call me Kaushik", "my name is Kaushik",
  // "it's Kaushik") — checked longest/most-specific first so "you can call
  // me" doesn't fall through to a plainer pattern. Falls back to the whole
  // utterance for a bare "Kaushik".
  const NAME_FRAMING_PATTERNS = [
    /\b(?:you (?:can|may|could)\s+|please\s+|i\s+)?call me\s+(.+)$/i,
    /\bmy name is\s+(.+)$/i,
    /\bthis is\s+(.+)$/i,
    /\bi am\s+(.+)$/i,
    /\bi'?m\s+(.+)$/i,
    /\bit'?s\s+(.+)$/i,
  ];

  // Common English function/question/math words that essentially never
  // appear in a bare spoken name — a short conversational preamble ("hey",
  // "so", "wait") or a spelled-out question ("two plus two equals what")
  // defeated the earlier version of this check, which only looked for a
  // question word as the very first word of the transcript. This list is
  // deliberately generous rather than exhaustive: the real filter is the
  // word-count cap below, this just catches the common cases fast.
  const NON_NAME_WORDS = new Set([
    "what", "whats", "who", "whos", "how", "hows", "when", "wheres", "where", "why", "which",
    "is", "are", "am", "was", "were", "do", "does", "did", "will", "would", "should", "can", "could",
    "the", "a", "an", "this", "that", "these", "those", "you", "your", "youre", "i", "im", "my", "me",
    "we", "us", "he", "she", "it", "they", "them",
    "plus", "minus", "times", "divided", "equals", "equal", "sum", "add", "subtract", "multiply", "multiplied",
    "yes", "no", "okay", "ok", "sure", "please", "weather", "news", "today", "tomorrow",
    "help", "sorry", "thanks", "thank", "hey", "hi", "hello", "so", "wait", "um", "uh",
    "and", "or", "but", "not", "know", "tell", "give", "show", "say", "said", "call", "calling", "called",
  ]);

  // A real spoken name is short and made of nothing but the name itself —
  // stripping every non-letter character (digits, punctuation, the
  // apostrophe in "what's") and splitting on whatever's left means "2+2"
  // and "what's" both reduce to tokens this can actually check, rather
  // than needing to anticipate every way a question gets phrased.
  function looksLikeSpokenName(transcript: string): boolean {
    const words = transcript
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0 || words.length > 3) return false;
    return words.every((w) => !NON_NAME_WORDS.has(w));
  }

  // Tries an explicit naming framing first ("you can call me X", "my name
  // is X" — NAME_FRAMING_PATTERNS), which always wins even if the captured
  // name itself would otherwise look borderline; falls back to treating
  // the whole utterance as a bare name only if it actually looks like one.
  function extractSpokenName(transcript: string): string | null {
    const cleaned = transcript.trim().replace(/[.,!?]+$/, "");
    for (const pattern of NAME_FRAMING_PATTERNS) {
      const match = cleaned.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return looksLikeSpokenName(cleaned) ? cleaned : null;
  }

  // The next transcript after "how may I call you" — see extractSpokenName
  // above for how a real name is recognized and pulled out, then
  // title-cased for display/speech. Anything that doesn't look like a name
  // (a real question, small talk, noise) is instead answered through the
  // normal public Q&A pipeline — same Gemini-backed fallback the dashboard
  // assistant uses — and then she asks for the name again.
  async function handleNameCaptured(transcript: string) {
    const raw = extractSpokenName(transcript);
    if (!raw) {
      setState("thinking");
      const outcome = await handlePublicTranscript(transcript, {
        showLogin: onShowLogin ?? (() => router.push("/login")),
        questionsAskedSoFar: questionCountRef.current,
      });
      if (outcome.kind === "action") {
        speakText(outcome.message, outcome.after);
        return;
      }
      if (outcome.kind === "spoken") {
        questionCountRef.current += 1;
        speakText(`${outcome.text} Anyway — how may I call you?`, startListening);
        return;
      }
      // Identity/bio/capabilities/tour intents need a full panel, which
      // doesn't fit mid-name-ask — get back to the name first; the options
      // carousel offers all of these again right after.
      speakText("Let's start with your name first — how may I call you?", startListening);
      return;
    }

    const name = raw.replace(/\b\w/g, (c) => c.toUpperCase());
    visitorNameRef.current = name;
    flowRef.current = "awaiting-more-info";
    speakText(`Okay, ${name}. Would you like to know more about me?`, startListening);
  }

  // The next transcript after "would you like to know more about me".
  function handleMoreInfoAnswer(transcript: string) {
    flowRef.current = "idle";
    const isYes = parseYesNo(transcript) === "yes";
    if (!isYes) {
      speakText("No problem — just say hi anytime.");
      return;
    }
    const name = visitorNameRef.current;
    speakText(
      name
        ? `Great, ${name} — here's what I can show you: a presentation, who built me, my super tasks, or all of the above.`
        : "Here's what I can show you: a presentation, who built me, my super tasks, or all of the above.",
      startListening,
    );
    setOverlay("options");
  }

  // "hello" (as opposed to a bare "hi") — either starts the name flow for
  // a first-time visitor, or, if she already knows this visitor's name
  // this session, greets them by it and skips straight to offering the
  // tour again.
  function handleHello() {
    const name = visitorNameRef.current;
    if (name) {
      flowRef.current = "awaiting-more-info";
      speakText(`Hi again, ${name}! Would you like to know more about me?`, startListening);
    } else {
      flowRef.current = "awaiting-name";
      speakText("Hi! How are you? May I know your name, please?", startListening);
    }
  }

  // Opens one tour panel, pausing the mic only for the presentation (its
  // multi-slide narration can't be covered by the single-utterance
  // grace-period echo guard — see the original "presentation" handling
  // this replaced). The other panels' spoken intros go through the normal
  // speakText() path.
  function openOverlayItem(kind: "presentation" | "bio" | "capabilities") {
    if (kind === "presentation") {
      wasListeningRef.current = shouldListenRef.current;
      shouldListenRef.current = false;
      presentingRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Already stopped — fine.
      }
      setState("idle");
    } else if (kind === "bio") {
      speakText(TARUN_BIO_SPOKEN_INTRO, isTouringRef.current ? closeOverlay : undefined);
    } else {
      speakText(CAPABILITIES_SPOKEN_INTRO, isTouringRef.current ? closeOverlay : undefined);
    }
    setOverlay(kind);
  }

  // Picking an option — from a voice intent or a carousel card tap alike.
  // "all" queues the other two panels so closing one opens the next.
  function activateOption(id: EveOptionId) {
    questionCountRef.current += 1;
    if (id === "all") {
      isTouringRef.current = true;
      queueRef.current = ["bio", "capabilities"];
      openOverlayItem("presentation");
    } else {
      isTouringRef.current = false;
      queueRef.current = [];
      openOverlayItem(id);
    }
  }

  // Called when the presentation finishes on its own, or the bio/
  // capabilities card's own Close button is pressed. Advances the "all of
  // the above" queue if there's more to show, otherwise closes for real
  // and resumes listening if a presentation had paused it.
  function closeOverlay() {
    const next = queueRef.current.shift();
    if (next) {
      // SkynetPresentation's own narration effect calls cancelSpeech() in
      // its cleanup when it unmounts (see its comment) — which happens as
      // part of the very setOverlay() re-render this triggers. Calling
      // openOverlayItem(next) (and its speakText) synchronously right here
      // raced that cleanup: the bio/capabilities card would open but its
      // intro line got silently cancelled before ever playing (exactly
      // "the panel showed but never spoke", live-verified). setOverlay
      // first forces that unmount (and its cancelSpeech) to actually
      // happen; deferring the next panel's open to a macrotask guarantees
      // it starts strictly after, regardless of React's own scheduling.
      setOverlay("none");
      setTimeout(() => openOverlayItem(next), 50);
      return;
    }
    isTouringRef.current = false;
    setOverlay("none");
    if (presentingRef.current) {
      presentingRef.current = false;
      if (wasListeningRef.current) {
        shouldListenRef.current = true;
        try {
          recognitionRef.current?.start();
        } catch {
          // Already running — fine.
        }
        setState("listening");
      } else {
        setState("idle");
      }
    }
  }

  function handleClick() {
    if (state === "speaking") {
      cancelSpeech();
      finishSpeaking({ muted: true });
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (shouldListenRef.current) {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {
        // Already stopped — fine, we just want it stopped.
      }
      setState("idle");
    } else {
      shouldListenRef.current = true;
      setHeard("");
      try {
        recognition.start();
      } catch {
        // Browser reports "already started" — a known SpeechRecognition
        // quirk where a prior stop() hasn't finished tearing down yet.
        // That's the state we wanted anyway, so just reflect it in the UI.
      }
      setState("listening");
    }
  }

  if (state === "unsupported") return null;

  const label =
    state === "speaking"
      ? "Mute SKYNET"
      : state === "listening"
        ? "Stop listening"
        : state === "thinking"
          ? "Thinking…"
          : "Talk to SKYNET";

  // Eye color carries her state: blue at rest/listening, a brighter pulse
  // while she talks (matching the "warm" accent used elsewhere for active
  // states), dimmer while thinking.
  const eyeColor = state === "speaking" ? "#ffb454" : state === "thinking" ? "#3a5f78" : "#5fc8ff";

  // Eye shape/tilt carries her mood the way EVE's actual character design
  // always has (no face rig — just tilting/squinting the lens shape). Mid-
  // conversation (waiting on a name or a yes/no) gets a distinct quizzical
  // tilt so the "is she waiting on me?" moment actually reads as one.
  const expression: EveExpression =
    flowRef.current === "awaiting-name" || flowRef.current === "awaiting-more-info"
      ? "curious"
      : state === "listening"
        ? "listening"
        : state === "thinking"
          ? "thinking"
          : state === "speaking"
            ? "happy"
            : "neutral";

  return (
    <div className="relative flex min-h-[70vh] w-full flex-col items-center justify-center gap-4">
      <div ref={rootRef} className="fixed z-10" style={{ left: "-15vw", top: "50%" }}>
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          className="block cursor-pointer border-none bg-transparent p-0"
        >
          <div
            ref={innerRef}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "clamp(84px,11vw,150px)",
              transform: "translate(-50%,-50%)",
              transformOrigin: "50% 85%",
            }}
          >
            {webglSupported ? (
              <Eve3D eyeColor={eyeColor} size={120} expression={expression} />
            ) : (
              <SkynetBot idPrefix="evePublic" eyeColor={eyeColor} armLeftRef={armLeftRef} armRightRef={armRightRef} />
            )}
          </div>
        </button>
      </div>
      {overlay === "presentation" ? (
        // EVE steps to the right (82vw) while this is open, so the panel
        // opens in the freed space on the left.
        <div className="flex w-full justify-start px-6 sm:pl-[6vw]">
          <SkynetPresentation onFinish={closeOverlay} />
        </div>
      ) : overlay === "bio" ? (
        // EVE steps to the left (18vw) while this is open, so the bio
        // card opens on the right instead — mirrors the presentation.
        <div className="flex w-full justify-end px-6 sm:pr-[6vw]">
          <TarunBioPoster onClose={closeOverlay} />
        </div>
      ) : overlay === "capabilities" ? (
        // Same side as the presentation — both are informational panels.
        <div className="flex w-full justify-start px-6 sm:pl-[6vw]">
          <SkynetCapabilities onClose={closeOverlay} />
        </div>
      ) : overlay === "options" ? (
        // Same side as the bio card — the interactive "pick one" moment.
        <div className="flex w-full justify-end px-6 sm:pr-[6vw]">
          <EveOptionsCarousel onPick={activateOption} />
        </div>
      ) : (
        <div className="mt-[18vw] flex flex-col items-center gap-2 sm:mt-40">
          {captionVisible && <CaptionDisplay words={captionWords} activeIndex={activeWordIndex} />}
          {state === "listening" && heard && (
            <span className="max-w-xs text-center text-xs text-[var(--foreground)]/50">Heard: &ldquo;{heard}&rdquo;</span>
          )}
          <span className="text-xs uppercase tracking-[0.2em] text-[var(--foreground)]/40">{label}</span>
        </div>
      )}
    </div>
  );
}
