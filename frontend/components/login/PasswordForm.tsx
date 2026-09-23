"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { GlassButton } from "@/components/GlassButton";

const MASK_CHAR = "*";

export function PasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const pendingCursor = useRef<number | null>(null);

  const displayedPassword = revealed ? password : MASK_CHAR.repeat(password.length);

  // The input's displayed text IS the mask (or the real password when
  // revealed) — there's no separate overlay layer, so the caret always sits
  // exactly where its rendered character is. The browser briefly applies
  // each keystroke to that mask string directly (e.g. typing "X" into
  // "***" produces "*X**"); onChange reads what edit actually happened from
  // the native InputEvent (inputType/data), replays the same edit against
  // the real `password` state, and the controlled re-render below overwrites
  // the DOM back to a clean mask with the caret restored to the right spot.
  useLayoutEffect(() => {
    if (pendingCursor.current !== null && passwordInputRef.current) {
      passwordInputRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  }, [displayedPassword]);

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>) {
    const native = event.nativeEvent as InputEvent;
    const target = event.target;
    // The browser already applied the edit by the time onChange fires, so
    // selectionStart reflects the post-edit caret — for insertions that's
    // exactly where the new content ends, which is what we need below.
    const cursorAfter = target.selectionStart ?? password.length;
    const oldLen = displayedPassword.length;
    const newLen = target.value.length;

    let next: string | null = null;
    let cursor = cursorAfter;

    switch (native.inputType) {
      case "insertText":
      case "insertFromPaste":
      case "insertFromDrop":
      case "insertReplacementText":
      case "insertCompositionText": {
        const inserted =
          native.data ??
          (native as InputEvent & { dataTransfer?: DataTransfer }).dataTransfer?.getData("text") ??
          "";
        // Covers both a plain insert and typing over a selection: the
        // replaced range's width is whatever the length delta doesn't
        // account for via the inserted text alone.
        const start = cursorAfter - inserted.length;
        const removed = oldLen - newLen + inserted.length;
        next = password.slice(0, start) + inserted + password.slice(start + removed);
        cursor = cursorAfter;
        break;
      }
      case "deleteContentBackward":
      case "deleteWordBackward":
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward":
      case "deleteContentForward":
      case "deleteWordForward":
      case "deleteHardLineForward":
      case "deleteByCut": {
        // Backward delete and forward delete both leave the caret at the
        // start of the removed range (backward: deletion shifts the caret
        // left to it; forward/cut: the caret never moved from it).
        const removed = oldLen - newLen;
        next = password.slice(0, cursorAfter) + password.slice(cursorAfter + removed);
        cursor = cursorAfter;
        break;
      }
      default: {
        // Unhandled edit type (autofill directly setting .value is the main
        // case) — the field's real value is the source of truth here.
        next = target.value;
        cursor = target.value.length;
      }
    }

    if (next !== null && next !== password) {
      pendingCursor.current = cursor;
      setPassword(next);
    } else if (displayedPassword !== target.value) {
      // Nothing changed in the real password but the mask still needs a
      // forced re-render to overwrite whatever the browser just wrote.
      pendingCursor.current = cursor;
      setPassword((current) => current);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error — try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="text-xs uppercase tracking-[0.2em] text-[var(--foreground)]/60">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="glass-panel rounded-xl border-none bg-white/5 px-4 py-3 text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--glow-primary)]"
          required
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-xs uppercase tracking-[0.2em] text-[var(--foreground)]/60">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            ref={passwordInputRef}
            type="text"
            name="password"
            autoComplete="current-password"
            value={displayedPassword}
            onChange={handlePasswordChange}
            className="glass-panel w-full rounded-xl border-none bg-white/5 px-4 py-3 pr-12 tracking-widest text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--glow-primary)]"
            required
          />
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--foreground)]/60 hover:text-[var(--foreground)]"
          >
            {revealed ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
                <path d="M4 4l16 16" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <GlassButton type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Sign In"}
      </GlassButton>
    </form>
  );
}
