"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

import { GlassButton } from "@/components/GlassButton";

type Mode = "register" | "login";

async function postJSON(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

/**
 * Real WebAuthn ceremony (registration or authentication) — the actual
 * security decision is 100% the OS's native Touch ID/Face ID prompt. The
 * scanning-line overlay shown while `scanning` is true is purely cosmetic,
 * layered on top for the cinematic moment while the browser's real
 * biometric prompt is doing the verifying.
 */
export function WebAuthnPrompt({
  mode,
  onSuccess,
  onSkip,
}: {
  mode: Mode;
  onSuccess: () => void;
  onSkip?: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => (typeof window !== "undefined" ? browserSupportsWebAuthn() : false));

  async function run() {
    setError(null);
    setScanning(true);
    try {
      const endpoint = mode === "register" ? "/api/auth/webauthn/register" : "/api/auth/webauthn/login";
      const options = await postJSON(endpoint, { action: "begin" });

      const response =
        mode === "register"
          ? await startRegistration({ optionsJSON: options })
          : await startAuthentication({ optionsJSON: options });

      await postJSON(endpoint, {
        action: "finish",
        response,
        ...(mode === "register" ? { label: guessDeviceLabel() } : {}),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setScanning(false);
    }
  }

  if (!supported) {
    return mode === "login" ? null : (
      <p className="text-xs text-[var(--foreground)]/50">Passkeys aren&apos;t supported in this browser.</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {scanning && (
        <div className="relative flex h-24 w-24 items-center justify-center" aria-hidden="true">
          <div className="face-outline" />
          <div className="scan-line" />
        </div>
      )}
      <GlassButton type="button" onClick={run} disabled={scanning} className="w-full">
        {scanning
          ? "Verifying…"
          : mode === "register"
            ? "Register Touch ID / Face ID"
            : "Sign in with Touch ID / Face ID"}
      </GlassButton>
      {mode === "register" && onSkip && (
        <button type="button" onClick={onSkip} className="text-xs text-[var(--foreground)]/50 underline">
          Skip for now
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <style>{`
        .face-outline {
          position: absolute;
          inset: 0;
          border-radius: 40% 40% 45% 45% / 50% 50% 40% 40%;
          border: 1.5px solid var(--glow-primary);
          opacity: 0.5;
        }
        .scan-line {
          position: absolute;
          left: 8%;
          right: 8%;
          height: 2px;
          background: var(--glow-primary);
          box-shadow: 0 0 12px var(--glow-primary);
          animation: scan 1400ms ease-in-out infinite;
        }
        @keyframes scan {
          0% { top: 10%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 85%; opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .scan-line { animation: none; top: 50%; opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone Face ID";
  if (/iPad/.test(ua)) return "iPad Face ID";
  if (/Macintosh/.test(ua)) return "MacBook Touch ID";
  return "Passkey";
}
