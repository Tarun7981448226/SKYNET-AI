"use client";

import { useEffect, useRef } from "react";

// Live captions for whatever VoiceService is currently speaking — the
// active word is highlighted and scrolled into view as speech progresses,
// so a longer briefing later scrolls itself past this row's width instead
// of overflowing.
export function CaptionDisplay({ words, activeIndex }: { words: string[]; activeIndex: number }) {
  const activeWordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    activeWordRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIndex]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass-panel flex max-w-md items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-full px-4 py-2 text-sm"
    >
      {words.map((word, index) => (
        <span
          key={`${word}-${index}`}
          ref={index === activeIndex ? activeWordRef : undefined}
          className={
            index === activeIndex
              ? "text-[var(--foreground)]"
              : index < activeIndex
                ? "text-[var(--foreground)]/40"
                : "text-[var(--foreground)]/60"
          }
        >
          {word}
        </span>
      ))}
    </div>
  );
}
