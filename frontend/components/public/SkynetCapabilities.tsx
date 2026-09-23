"use client";

import { useEffect, useRef, useState } from "react";

import { HologramBackdrop } from "@/components/public/HologramBackdrop";

// Triggered by "what can you do" / "super tasks" on the public page — a
// quick, factual capabilities rundown, distinct from SkynetPresentation
// (a narrated multi-slide story). Real, already-shipped features only —
// nothing aspirational.
// Presented as a real 3D coverflow (same rotate-to-browse mechanic and
// per-card local perspective() as EveOptionsCarousel — see its comment for
// why that's a self-contained transform rather than a shared preserve-3d
// ancestor: this always renders inside a backdrop-filter glass-panel,
// which flattens nested 3D contexts in Safari/WebKit), auto-advancing
// here since there's no pick to make, over the same wireframe-hologram
// backdrop the presentation uses, rather than a flat checklist.
export const CAPABILITIES_SPOKEN_INTRO = "Here's what I actually do for Tarun, day in and day out.";

const TASKS = [
  {
    label: "Search 5 sources every hour",
    detail: "Company career pages, job boards, Telegram channels, LinkedIn alerts, and shared links.",
  },
  {
    label: "Score every job's fit",
    detail: "Matched against his real resume and interests — not a keyword count.",
  },
  {
    label: "Tailor and render his resume",
    detail: "For strong matches, a one-page ATS-safe PDF and DOCX, ready to send.",
  },
  {
    label: "Log everything to Sheets",
    detail: "Every job, score, and resume link lands in his tracking sheet automatically.",
  },
  {
    label: "Alert him on Telegram",
    detail: "Failures, successes, and a daily morning digest of what's ready.",
  },
  {
    label: "Show a live dashboard",
    detail: "Real stats and a filtered job feed he reviews and decides on.",
  },
];

const STEP_PX = 200;
const AUTO_ADVANCE_MS = 3200;

export function SkynetCapabilities({ onClose }: { onClose: () => void }) {
  const [front, setFront] = useState(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      setFront((f) => (f + 1) % TASKS.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, []);

  function rotate(dir: 1 | -1) {
    pausedRef.current = true;
    setFront((f) => (f + dir + TASKS.length) % TASKS.length);
  }

  return (
    <div
      className="glass-panel relative flex w-full max-w-sm flex-col items-center gap-4 overflow-hidden px-6 py-6"
      onMouseEnter={() => (pausedRef.current = true)}
      onMouseLeave={() => (pausedRef.current = false)}
    >
      <HologramBackdrop color="#5fc8ff" />
      <h3 className="text-center text-sm font-semibold uppercase tracking-[0.15em] text-[var(--foreground)]/80">
        My super tasks
      </h3>

      <div className="relative" style={{ width: "100%", height: 150 }}>
        {TASKS.map((task, i) => {
          let offset = i - front;
          if (offset > TASKS.length / 2) offset -= TASKS.length;
          if (offset < -TASKS.length / 2) offset -= TASKS.length;
          const isFront = offset === 0;
          const isAdjacent = Math.abs(offset) === 1;
          const hidden = Math.abs(offset) > 1;
          return (
            <div
              key={task.label}
              aria-hidden={hidden}
              className="glass-panel absolute left-1/2 top-0 flex flex-col items-center justify-center gap-1.5 px-4 py-3 text-center transition-all duration-700"
              style={{
                width: 200,
                transform: `translateX(calc(-50% + ${offset * STEP_PX}px)) perspective(700px) rotateY(${offset * -28}deg) scale(${isFront ? 1 : 0.86})`,
                transitionTimingFunction: "cubic-bezier(.35,.05,.25,1)",
                opacity: hidden ? 0 : isFront ? 1 : 0.5,
                zIndex: isFront ? 3 : isAdjacent ? 2 : 1,
              }}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--foreground)]/40">
                {i + 1} / {TASKS.length}
              </span>
              <span className="text-sm font-medium text-[var(--foreground)]">{task.label}</span>
              <span className="text-xs text-[var(--foreground)]/55">{task.detail}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => rotate(-1)}
          aria-label="Previous task"
          className="glass-button flex h-8 w-8 items-center justify-center p-0"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => rotate(1)}
          aria-label="Next task"
          className="glass-button flex h-8 w-8 items-center justify-center p-0"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <button type="button" onClick={onClose} className="text-xs text-[var(--foreground)]/50 underline">
        Close
      </button>
    </div>
  );
}
