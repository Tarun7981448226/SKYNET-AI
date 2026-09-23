"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { WallpaperVideo } from "@/components/WallpaperVideo";
import { LoginPanel } from "@/components/login/LoginPanel";
import { EvePublic } from "@/components/public/EvePublic";
import { GlassButton } from "@/components/GlassButton";

// Public landing page — no session required, one single URL. EVE acts as
// a guardian in front of the real sign-in form: the form is hidden by
// default and she spends her time answering visitors' questions (who she
// is, who made her, the weather — see lib/voice/publicAssistant.ts for
// what she deliberately can't answer, and the 10-question-per-page-load
// cap there). Saying "sign in" reveals the actual LoginPanel right here,
// on the same page, rather than navigating anywhere — same component
// /login itself uses, same WallpaperVideo background. A visible "Sign In"
// button in the corner is a second, silent way in for anyone who'd rather
// not talk to her — voice isn't the only path to the form.
export default function Home() {
  const router = useRouter();
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <WallpaperVideo />
      {!showLogin && (
        <GlassButton
          onClick={() => setShowLogin(true)}
          className="fixed right-6 top-6 z-20"
        >
          Sign In
        </GlassButton>
      )}
      {showLogin ? (
        <>
          <button
            type="button"
            onClick={() => setShowLogin(false)}
            aria-label="Back"
            className="glass-button fixed left-6 top-6 z-20 flex h-10 w-10 items-center justify-center p-0"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <LoginPanel onSuccess={() => router.push("/dashboard")} />
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3">
            <h1 className="skynet-title text-3xl font-bold tracking-[0.08em]">SKYNET</h1>
            <p className="max-w-md text-sm text-[var(--foreground)]/60">Tarun&rsquo;s personal AI job assistant.</p>
          </div>
          <EvePublic onShowLogin={() => setShowLogin(true)} />
        </>
      )}
    </div>
  );
}
