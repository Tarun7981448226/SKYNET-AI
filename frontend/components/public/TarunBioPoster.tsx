"use client";

import { useState } from "react";

// Triggered by "who is Tarun" / "where is Tarun from" / "what does Tarun
// do" on the public page — a small static bio card, not a multi-slide
// walkthrough (that's SkynetPresentation.tsx, for "who are you"/"what do
// you do" about SKYNET itself). Real facts only, matching what's already
// used elsewhere in this project (backend/data/resume_aiml.md's contact
// section) — no invented details.
// Exported so other public-page components (SkynetPresentation.tsx's
// closing slide) link to the same real contact details instead of each
// keeping its own copy.
export const PHONE = "+1 (213) 210-1143";
export const EMAIL = "tarundeepreddybv@gmail.com";

// public/assets/tarun.jpg isn't checked into the repo yet — same
// graceful-fallback pattern as WallpaperVideo.tsx for the wallpaper video
// it expects: falls back to a plain initials avatar instead of a broken
// image if the real photo hasn't been dropped in.
function TarunPhoto() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="flex h-28 w-28 items-center justify-center rounded-full text-2xl font-semibold text-[var(--foreground)]"
        style={{ background: "linear-gradient(135deg, rgba(95,200,255,0.25), rgba(255,180,84,0.25))" }}
      >
        TD
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/assets/tarun.jpg"
      alt="Tarun Deep Reddy B V"
      className="h-28 w-28 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function TarunBioPoster({ onClose }: { onClose: () => void }) {
  return (
    <div className="glass-panel flex w-full max-w-sm flex-col items-center gap-4 px-6 py-6 text-center">
      <TarunPhoto />
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Tarun Deep Reddy B V</h3>
        <p className="mt-1 text-sm text-[var(--foreground)]/70">
          M.S. Computer Science student at the University of Southern California — and the person who built me.
        </p>
      </div>
      <div className="flex flex-col gap-1 text-sm text-[var(--foreground)]/70">
        <a href={`mailto:${EMAIL}`} className="underline">
          {EMAIL}
        </a>
        <a href={`tel:${PHONE.replace(/[^\d+]/g, "")}`} className="underline">
          {PHONE}
        </a>
      </div>
      <button type="button" onClick={onClose} className="text-xs text-[var(--foreground)]/50 underline">
        Close
      </button>
    </div>
  );
}
