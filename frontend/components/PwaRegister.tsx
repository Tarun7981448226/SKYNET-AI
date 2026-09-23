"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) unconditionally, site-wide —
// harmless on the public landing page too, and needed everywhere a Web
// Push subscription might later be created (SiriOrb.tsx's orb click).
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort — a failed registration just means no offline/push
        // support this session, not a broken app.
      });
    }
  }, []);
  return null;
}
