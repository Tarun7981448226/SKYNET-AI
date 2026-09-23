"use client";

import { useState } from "react";

/**
 * Full-bleed looping background video (frontend/public/assets/skynet_wallpaper.mp4)
 * with a dark scrim on top so foreground text stays readable.
 *
 * That video file isn't checked into the repo yet (a real asset the user
 * provides) — if it 404s, this falls back to a static gradient that
 * approximates the same glow palette instead of showing a broken/black
 * video element.
 */
export function WallpaperVideo() {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {videoFailed ? (
        <div
          className="h-full w-full"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(56,189,248,0.25), transparent 55%), radial-gradient(circle at 75% 70%, rgba(129,140,248,0.2), transparent 50%), #05070d",
          }}
        />
      ) : (
        <video
          className="h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          poster="/assets/skynet_wallpaper_poster.jpg"
          onError={() => setVideoFailed(true)}
        >
          <source src="/assets/skynet_wallpaper.mp4" type="video/mp4" />
        </video>
      )}
      <div className="absolute inset-0" style={{ background: "var(--scrim)" }} />
    </div>
  );
}
