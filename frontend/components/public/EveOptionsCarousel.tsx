"use client";

import { useState } from "react";

// The "tour" picker offered once a visitor says yes to "would you like to
// know more about me" — 4 cards you rotate through and pick. Each card
// carries its own self-contained perspective()+rotateY (not a shared
// `transform-style: preserve-3d` ancestor) deliberately — Safari/WebKit has
// a well-documented bug flattening nested 3D transform contexts that sit
// under a `backdrop-filter` ancestor (which every glass-panel in this app
// is), and this carousel always renders inside one. A per-card local
// perspective has no parent 3D context to flatten, so it can't hit that
// bug on any browser. Picking a card routes into the exact same outcome
// handling EvePublic.tsx already uses for voice ("presentation"/"bio"/
// "capabilities"), so saying an option out loud does the same thing as
// tapping its card.
export type EveOptionId = "presentation" | "bio" | "capabilities" | "all";

interface EveOptionDef {
  id: EveOptionId;
  title: string;
  blurb: string;
}

const OPTIONS: EveOptionDef[] = [
  { id: "presentation", title: "1 · A presentation", blurb: "A narrated walkthrough with a live 3D workflow diagram." },
  { id: "bio", title: "2 · Meet my creator", blurb: "Who built me, and why." },
  { id: "capabilities", title: "3 · My super tasks", blurb: "Everything I actually do for Tarun, day to day." },
  { id: "all", title: "4 · All of the above", blurb: "Give me the whole tour." },
];

const STEP_PX = 210;

export function EveOptionsCarousel({ onPick }: { onPick: (id: EveOptionId) => void }) {
  const [front, setFront] = useState(0);

  function rotate(dir: 1 | -1) {
    setFront((f) => (f + dir + OPTIONS.length) % OPTIONS.length);
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <div className="relative" style={{ width: "100%", height: 160 }}>
        {OPTIONS.map((opt, i) => {
          // Shortest signed distance around the 4-card ring (-2..2) — so
          // going from card 4 back to card 1 steps +1, not -3.
          let offset = i - front;
          if (offset > OPTIONS.length / 2) offset -= OPTIONS.length;
          if (offset < -OPTIONS.length / 2) offset -= OPTIONS.length;
          const isFront = offset === 0;
          const isAdjacent = Math.abs(offset) === 1;
          const hidden = Math.abs(offset) > 1;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => (isFront ? onPick(opt.id) : setFront(i))}
              aria-label={isFront ? `Choose: ${opt.title}` : `Rotate to ${opt.title}`}
              aria-hidden={hidden}
              tabIndex={hidden ? -1 : 0}
              className="glass-panel absolute left-1/2 top-0 flex cursor-pointer flex-col items-center justify-center gap-1.5 px-4 py-3 text-center transition-all duration-500"
              style={{
                width: 200,
                transform: `translateX(calc(-50% + ${offset * STEP_PX}px)) perspective(700px) rotateY(${offset * -28}deg) scale(${isFront ? 1 : 0.86})`,
                transitionTimingFunction: "cubic-bezier(.35,.05,.25,1)",
                opacity: hidden ? 0 : isFront ? 1 : 0.55,
                zIndex: isFront ? 3 : isAdjacent ? 2 : 1,
                pointerEvents: hidden ? "none" : "auto",
              }}
            >
              <span className="text-sm font-semibold text-[var(--foreground)]">{opt.title}</span>
              <span className="text-xs text-[var(--foreground)]/60">{opt.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => rotate(-1)}
          aria-label="Previous option"
          className="glass-button flex h-9 w-9 items-center justify-center p-0"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--foreground)]/50">Tap the front card to pick</span>
        <button
          type="button"
          onClick={() => rotate(1)}
          aria-label="Next option"
          className="glass-button flex h-9 w-9 items-center justify-center p-0"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
