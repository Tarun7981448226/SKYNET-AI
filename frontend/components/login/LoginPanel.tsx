"use client";

import { useEffect, useState } from "react";

import { GlassCard } from "@/components/GlassCard";
import { PasswordForm } from "@/components/login/PasswordForm";
import { SuccessCheckmark } from "@/components/login/SuccessCheckmark";
import { WebAuthnPrompt } from "@/components/login/WebAuthnPrompt";

type Stage = "password" | "webauthn-login" | "register-prompt" | "success";

// The actual sign-in UI (password / WebAuthn / passkey-registration-offer /
// success stages), extracted out of app/login/page.tsx so it can be reused
// both at the standalone /login route and embedded — hidden until asked
// for — on the public landing page (app/page.tsx), behind EVE acting as a
// guardian in front of it.
export function LoginPanel({ onSuccess }: { onSuccess: () => void }) {
  const [stage, setStage] = useState<Stage>("password");
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/webauthn/status")
      .then((res) => res.json())
      .then((data) => setHasCredential(Boolean(data.hasCredential)))
      .catch(() => setHasCredential(false));
  }, []);

  function finish() {
    setStage("success");
    setTimeout(onSuccess, 700);
  }

  function handlePasswordSuccess() {
    // Only offer to register a passkey the first time none exists yet.
    if (hasCredential === false) {
      setStage("register-prompt");
    } else {
      finish();
    }
  }

  return (
    <GlassCard className="w-full max-w-sm">
      {stage === "success" && <SuccessCheckmark label="Welcome back, Mr. Reddy" />}

      {stage === "register-prompt" && (
        <>
          <h2 className="mb-1 text-center text-lg font-semibold tracking-wide text-[var(--foreground)]">
            Register a Passkey?
          </h2>
          <p className="mb-6 text-center text-xs text-[var(--foreground)]/60">
            Sign in next time with Touch ID or Face ID instead of your password.
          </p>
          <WebAuthnPrompt mode="register" onSuccess={finish} onSkip={finish} />
        </>
      )}

      {(stage === "password" || stage === "webauthn-login") && (
        <>
          <h1 className="skynet-title mb-6 text-center text-3xl font-bold tracking-[0.08em]">SKYNET</h1>

          {stage === "webauthn-login" ? (
            <WebAuthnPrompt mode="login" onSuccess={finish} />
          ) : (
            <PasswordForm onSuccess={handlePasswordSuccess} />
          )}

          {hasCredential && (
            <button
              type="button"
              onClick={() => setStage(stage === "webauthn-login" ? "password" : "webauthn-login")}
              className="mt-4 w-full text-center text-xs text-[var(--foreground)]/50 underline"
            >
              {stage === "webauthn-login" ? "Use password instead" : "Sign in with Touch ID / Face ID instead"}
            </button>
          )}
        </>
      )}
    </GlassCard>
  );
}
