"use client";

import { useEffect, useRef, useState } from "react";

import { speak, cancelSpeech } from "@/lib/voice/VoiceService";
import { HologramOrb } from "@/components/dashboard/HologramOrb";
import { HologramBackdrop } from "@/components/public/HologramBackdrop";
import { PipelineWorkflow3D } from "@/components/public/PipelineWorkflow3D";
import { SkynetBot } from "@/components/character/SkynetBot";
import { EMAIL, PHONE } from "@/components/public/TarunBioPoster";

// Triggered by "who are you" / "what do you do" on the public page instead
// of a one-line answer — a real, narrated walk-through of what SKYNET
// actually does, per Tarun's own explicit brief for the content. The 3D
// wireframe orb (HologramOrb — the same visual used on /dashboard once EVE
// hands off there) anchors it throughout, turning active while narrating,
// tying "EVE is SKYNET" together visually. Each slide auto-advances once
// its line finishes being spoken.
function isWebglSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

interface Slide {
  title: string;
  text: string;
  icon: React.ReactNode;
}

const ICON_PROPS = { width: 40, height: 40, viewBox: "0 0 40 40", fill: "none", stroke: "#5fc8ff", strokeWidth: 1.6 };

const SLIDES: Slide[] = [
  {
    title: "Searching, around the clock",
    text:
      "I'm SKYNET. I search the internet around the clock for jobs and internships that could be a fit for Tarun " +
      "— company career pages, job boards, and more.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="17" cy="17" r="10" />
        <path d="M25 25 L34 34" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Watching his channels",
    text:
      "I also watch his Telegram job channels and LinkedIn posts directly, so postings he'd otherwise miss " +
      "don't slip through.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M6 10 L34 10 L34 26 L16 26 L8 33 L8 26 L6 26 Z" strokeLinejoin="round" />
        <circle cx="14" cy="18" r="1.4" fill="#5fc8ff" stroke="none" />
        <circle cx="20" cy="18" r="1.4" fill="#5fc8ff" stroke="none" />
        <circle cx="26" cy="18" r="1.4" fill="#5fc8ff" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Scoring the fit",
    text:
      "For every posting I find, I score how well it actually fits his interests — AI and machine learning, " +
      "software engineering, and more.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="20" cy="20" r="14" />
        <circle cx="20" cy="20" r="8" />
        <circle cx="20" cy="20" r="2" fill="#5fc8ff" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Tailoring his resume",
    text:
      "For the strong matches, I tailor his resume specifically for that role, so it's ready for him to apply " +
      "directly — no extra work on his end.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="9" y="5" width="18" height="30" rx="2" />
        <path d="M14 13 L22 13 M14 18 L22 18 M14 23 L19 23" strokeLinecap="round" />
        <path d="M24 26 L33 17 L36 20 L27 29 L23 30 Z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Running every hour",
    text: "I run this whole process every single hour, all day — searching, scoring, and preparing, continuously.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="20" cy="20" r="14" />
        <path d="M20 12 L20 20 L26 24" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Ready every morning",
    text: "And every morning, everything I found and prepared overnight is ready and waiting for him.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M6 26 L34 26" strokeLinecap="round" />
        <path d="M11 26 A9 9 0 0 1 29 26" />
        <path d="M20 6 L20 10 M8 14 L11 16 M32 14 L29 16" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Or, tell me directly",
    text:
      "And if a posting ever slips past me, Tarun can paste the link straight into his dashboard — I read it, " +
      "score it, tailor his resume, and send it right back to his phone, no waiting for the hourly run.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="8" y="9" width="17" height="23" rx="2" />
        <path d="M12.5 16 L21 16 M12.5 21 L21 21 M12.5 26 L18 26" strokeLinecap="round" />
        <path d="M27 6 L35 6 L35 14" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35 6 L24.5 16.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

// The last slide shows illustrative visuals instead of a line icon: EVE
// herself (a small drawn recreation, not a photo — nothing on this site
// uses raster screenshots, same character/path data as EvePublic.tsx) and
// a stylized dashboard preview with clearly example numbers, never real
// data (this page is unauthenticated).
function MiniEve() {
  return (
    <div style={{ width: 56 }} aria-hidden="true">
      <SkynetBot idPrefix="miniEve" eyeColor="#5fc8ff" />
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="grid w-full max-w-[220px] grid-cols-2 gap-2 text-left">
      {[
        { label: "New today", value: "8" },
        { label: "Strong matches", value: "3" },
        { label: "Resumes ready", value: "3" },
        { label: "Applied", value: "2" },
      ].map((tile) => (
        <div key={tile.label} className="glass-panel px-3 py-2">
          <div className="text-lg font-semibold text-[var(--foreground)]">{tile.value}</div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--foreground)]/50">{tile.label}</div>
        </div>
      ))}
      <div className="col-span-2 text-center text-[10px] uppercase tracking-[0.15em] text-[var(--foreground)]/35">
        example numbers — not live data
      </div>
    </div>
  );
}

const FINAL_SLIDE: Slide = {
  title: "What it looks like",
  text: "This is what it looks like — me, and the dashboard where he reviews everything I find.",
  icon: (
    <div className="flex flex-col items-center gap-3">
      <MiniEve />
      <DashboardPreview />
    </div>
  ),
};

const ALL_SLIDES = [...SLIDES, FINAL_SLIDE];

export function SkynetPresentation({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [narrating, setNarrating] = useState(true);
  // A generation counter, not a plain boolean flag — Next/Back/dot-clicks
  // call cancelSpeech(), which rejects the *current* slide's speak()
  // promise asynchronously (the browser fires the utterance's error event
  // on a later tick, after the click handler has already moved `index`
  // on). A single shared boolean got reset to false by the *new* slide's
  // effect run before that stale rejection's .catch() fired, so it read
  // the wrong (already-reset) value and closed the whole presentation —
  // exactly what "clicking Next closes it" was. Each effect run gets its
  // own generation number instead, so a stale async callback can tell it
  // no longer belongs to the current slide.
  const generationRef = useRef(0);
  const indexRef = useRef(0);
  indexRef.current = index;
  // Gives each slide's icon a real 3D flip-in instead of a flat swap — a
  // small taste of the same "3D virtual" treatment as the wireframe
  // backdrop, on the one element that actually changes per slide.
  const iconRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = iconRef.current;
    if (!el) return;
    el.animate(
      [
        { transform: "rotateY(70deg) translateZ(-40px)", opacity: 0 },
        { transform: "rotateY(0deg) translateZ(0px)", opacity: 1 },
      ],
      { duration: 550, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" },
    );
  }, [index]);
  // Client-side only (useEffect, not a lazy useState initializer) so SSR's
  // initial HTML — where WebGL never exists — doesn't permanently bake in
  // "unsupported" even in a browser that actually has it. Three.js's
  // WebGLRenderer can throw outright without this guard, same reasoning
  // as SiriOrb.tsx's identical check before mounting HologramOrb.
  const [webglSupported, setWebglSupported] = useState(false);
  useEffect(() => {
    setWebglSupported(isWebglSupported());
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const myGen = generationRef.current;
    setNarrating(true);
    speak(ALL_SLIDES[index].text)
      .then(() => {
        if (generationRef.current !== myGen) return; // superseded by Next/Back/a dot click
        if (indexRef.current + 1 >= ALL_SLIDES.length) {
          setTimeout(() => {
            if (generationRef.current === myGen) onFinish();
          }, 500);
        } else {
          setIndex((i) => i + 1);
        }
      })
      .catch(() => {
        // cancelSpeech() (Next/Back/a dot click/Skip) rejects the in-flight
        // utterance too — nothing to do here for a superseded generation
        // (the new slide's own effect run already started), and Skip
        // closes the presentation itself via handleSkip below rather than
        // through this rejection.
      })
      .finally(() => {
        if (generationRef.current === myGen) setNarrating(false);
      });
    return () => {
      // Without this, React's dev-mode double-invoke (mount, cleanup,
      // mount again — StrictMode) let the *first*, throwaway mount's
      // speak() call run all the way through uncancelled, then the real
      // mount narrated the same slide again right after — exactly the
      // "reads the first page twice" bug. Bumping the generation here too
      // (not just at the top of the next real run) invalidates that
      // phantom run's callbacks, and cancelling speech cuts its audio off
      // immediately instead of letting it finish.
      generationRef.current += 1;
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function goTo(i: number) {
    cancelSpeech();
    setIndex(i);
  }

  function handleSkip() {
    generationRef.current += 1; // invalidate whatever's in flight
    cancelSpeech();
    onFinish();
  }

  const slide = ALL_SLIDES[index];
  const isLast = index === ALL_SLIDES.length - 1;
  // The 7 pipeline/Plan-B slides (indices 0-6) share one persistently-
  // mounted diagram instead of each getting its own icon — see
  // PipelineWorkflow3D.tsx. It never remounts across these slides (same
  // position in the tree, no key), it just receives a new activeStage, so
  // it reads as one continuous diagram lighting up progressively.
  const isPipelineSlide = index < SLIDES.length;

  return (
    <div className="glass-panel relative flex w-full max-w-md flex-col items-center gap-4 overflow-hidden px-6 py-6">
      {webglSupported && <HologramBackdrop color={narrating ? "#ffb454" : "#5fc8ff"} />}
      {webglSupported ? (
        <HologramOrb state={narrating ? "speaking" : "idle"} onClick={handleSkip} label="Skip presentation" size={92} />
      ) : (
        <button
          type="button"
          onClick={handleSkip}
          aria-label="Skip presentation"
          className="h-14 w-14 rounded-full"
          style={{
            background: narrating ? "#ffb454" : "#5fc8ff",
            boxShadow: `0 0 24px ${narrating ? "#ffb454" : "#5fc8ff"}`,
            transition: "background 300ms ease, box-shadow 300ms ease",
          }}
        />
      )}

      <div className="flex flex-col items-center gap-3 text-center">
        {/* The pipeline diagram needs real room (h-44); the final slide's
            EVE + dashboard mockup only needs enough not to clip. perspective
            on this wrapper is what gives the icon's own rotateY flip (see
            iconRef above) actual depth instead of just squashing flat. */}
        <div
          className={isPipelineSlide ? "flex h-44 w-full items-center justify-center" : "flex min-h-10 items-center justify-center"}
          style={{ perspective: "600px" }}
        >
          <div ref={iconRef} className={isPipelineSlide ? "h-full w-full" : undefined} style={{ transformStyle: "preserve-3d" }}>
            {isPipelineSlide && webglSupported ? <PipelineWorkflow3D activeStage={index} /> : slide.icon}
          </div>
        </div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-[var(--foreground)]/80">
          {slide.title}
        </h3>
        <p className="max-w-sm text-sm text-[var(--foreground)]/70">{slide.text}</p>
        {/* Recruiters watching to the end should be able to reach Tarun
            directly without hunting for the bio card — real, clickable
            mailto:/tel: links, same contact details TarunBioPoster.tsx
            already shows. */}
        {isLast && (
          <div className="flex flex-col items-center gap-1 pt-1 text-xs text-[var(--foreground)]/60">
            <span className="uppercase tracking-[0.15em] text-[var(--foreground)]/40">Reach Tarun directly</span>
            <a href={`mailto:${EMAIL}`} className="underline">
              {EMAIL}
            </a>
            <a href={`tel:${PHONE.replace(/[^\d+]/g, "")}`} className="underline">
              {PHONE}
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {ALL_SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Go to slide ${i + 1}: ${s.title}`}
            onClick={() => goTo(i)}
            className="h-1.5 w-1.5 rounded-full transition-colors"
            style={{ background: i === index ? "#5fc8ff" : "rgba(180,196,230,0.25)" }}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => goTo(Math.max(0, index - 1))}
          disabled={index === 0}
          className="text-[var(--foreground)]/50 underline disabled:opacity-30"
        >
          Back
        </button>
        {!isLast && (
          <button type="button" onClick={() => goTo(index + 1)} className="text-[var(--foreground)]/50 underline">
            Next
          </button>
        )}
        <button type="button" onClick={handleSkip} className="text-[var(--foreground)]/50 underline">
          {isLast ? "Close" : "Skip"}
        </button>
      </div>
    </div>
  );
}
