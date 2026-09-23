"use client";

import { useRouter } from "next/navigation";

import { WallpaperVideo } from "@/components/WallpaperVideo";
import { LoginPanel } from "@/components/login/LoginPanel";

export default function LoginPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <WallpaperVideo />
      {/* Reachable after "sign out" from the dashboard lands here — a way
          back to EVE's page instead of a dead end at the login form. */}
      <button
        type="button"
        onClick={() => router.push("/")}
        aria-label="Back"
        className="glass-button fixed left-6 top-6 z-10 flex h-11 w-11 items-center justify-center text-[var(--foreground)]/80 hover:text-[var(--foreground)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <LoginPanel onSuccess={() => router.push("/dashboard")} />
    </div>
  );
}
