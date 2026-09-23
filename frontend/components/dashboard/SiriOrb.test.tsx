import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SiriOrb } from "./SiriOrb";

// speak() never resolves in this test — simulating SKYNET still actively
// talking, which is exactly the state the "mute mid-speech" bug happened in.
vi.mock("@/lib/voice/VoiceService", () => ({
  isSpeechSupported: () => true,
  speak: vi.fn(() => new Promise<void>(() => {})),
  cancelSpeech: vi.fn(),
}));
vi.mock("@/lib/auth/signOut", () => ({ signOutRequest: vi.fn(() => Promise.resolve()) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

interface FakeResult {
  results: { 0: { transcript: string } }[];
}

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: FakeResult) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

const SAMPLE_JOB = {
  id: 42,
  company: "Acme",
  role: "Staff Engineer",
  type: null,
  location: null,
  domain: null,
  user_decision: null,
  status: "tailored",
  apply_url: null,
  posted_date: null,
  created_at: new Date().toISOString(),
  score: 88,
  gaps: null,
  visa_flag: null,
  drive_link: null,
  source: "greenhouse:acme",
};

const OTHER_JOB = { ...SAMPLE_JOB, id: 43, company: "Widgetco", role: "Backend Engineer" };

describe("SiriOrb", () => {
  let recognitionInstance: FakeRecognition;

  beforeEach(() => {
    recognitionInstance = new FakeRecognition();
    vi.stubGlobal(
      "SpeechRecognition",
      vi.fn(function () {
        return recognitionInstance;
      }),
    );
    // Default fetch stub so the mount-time morning-briefing fetch
    // (GET /api/dashboard/stats) doesn't hit a real/undefined fetch in
    // tests that don't care about it — individual tests override this.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("interrupts speech immediately when 'mute' is heard while SKYNET is still talking", async () => {
    const { cancelSpeech } = await import("@/lib/voice/VoiceService");
    render(<SiriOrb />);

    // The auto-greeting on mount puts it into "speaking" (speak() never
    // resolves in this mock, so it stays there).
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Mute SKYNET"));

    recognitionInstance.onresult?.({ results: [[{ transcript: "mute" }] as never] });

    await waitFor(() => expect(cancelSpeech).toHaveBeenCalledTimes(1));
  });

  it("ignores non-interrupt speech heard while still talking, rather than treating it as a new request", async () => {
    const { cancelSpeech } = await import("@/lib/voice/VoiceService");
    render(<SiriOrb />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Mute SKYNET"));

    recognitionInstance.onresult?.({ results: [[{ transcript: "what's the weather" }] as never] });

    // Give any (incorrect) async dispatch a tick to have fired if it were
    // going to, then confirm it didn't — still speaking, nothing muted.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cancelSpeech).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Mute SKYNET");
  });

  it("does not treat a delayed transcript of its own recent speech as a new request", async () => {
    // Real bug this covers: recognition doesn't finalize instantly, so a
    // transcript of audio captured *while* SKYNET was still talking can
    // arrive *after* isSpeakingRef has already flipped back to false —
    // that stale self-heard text must still not be dispatched as if a
    // person had just asked something.
    const { speak } = await import("@/lib/voice/VoiceService");
    vi.mocked(speak).mockImplementationOnce(() => Promise.resolve());

    render(<SiriOrb />);

    // The greeting (e.g. "Good evening, Taroon." — the exact time-of-day
    // word varies with the real clock, but it always ends in the
    // respelled name) resolves quickly via the override above, going back
    // to idle.
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Talk to SKYNET"));
    expect(speak).toHaveBeenCalledTimes(1);

    // A transcript closely matching what was just spoken arrives shortly
    // after — still within the grace period. "taroon" alone is enough to
    // overlap regardless of which time-of-day word was actually spoken.
    recognitionInstance.onresult?.({ results: [[{ transcript: "taroon" }] as never] });

    await new Promise((resolve) => setTimeout(resolve, 10));
    // If this had been treated as a fresh request, SKYNET would speak
    // again (a second speak() call, state back to "speaking").
    expect(speak).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Talk to SKYNET");
  });

  it("speaks a real data-driven morning briefing instead of a plain greeting", async () => {
    const { speak } = await import("@/lib/voice/VoiceService");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/dashboard/stats")) {
          return {
            ok: true,
            json: async () => ({
              applied: 0,
              rejected: 0,
              pending: 2,
              strongMatches: 1,
              mediumMatches: 0,
              lowMatches: 0,
              newToday: 3,
              resumesReady: 0,
            }),
          };
        }
        return { ok: false };
      }),
    );

    render(<SiriOrb />);

    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Mute SKYNET"));
    const [spokenText] = vi.mocked(speak).mock.calls[0];
    expect(spokenText).toContain("SKYNET found 3 new jobs today");
    expect(spokenText).toContain("2 jobs are still waiting on your decision.");
  });

  it("resolves 'the second one' from a job list just read aloud and reads it back", async () => {
    const { speak } = await import("@/lib/voice/VoiceService");
    // Only the greeting and the pending-list read-out need to actually
    // resolve — resolving flips isSpeakingRef back off and stamps
    // speechEndTimeRef, which is what lets the *next* transcript be
    // processed as a new request instead of speaking-adjacent noise.
    vi.mocked(speak).mockImplementationOnce(() => Promise.resolve()).mockImplementationOnce(() => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/dashboard/jobs")) {
          return { ok: true, json: async () => ({ jobs: [SAMPLE_JOB, OTHER_JOB] }) };
        }
        return { ok: false };
      }),
    );

    render(<SiriOrb />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Talk to SKYNET"));

    // Real wall-clock wait, longer than SPEECH_GRACE_PERIOD_MS (1500ms) —
    // a transcript heard within that window of SKYNET's own last speech
    // is treated as speaking-adjacent (self-echo protection) and would be
    // silently dropped rather than dispatched as a new request.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    recognitionInstance.onresult?.({ results: [[{ transcript: "what's still pending" }] as never] });
    await waitFor(() =>
      expect(vi.mocked(speak)).toHaveBeenCalledWith(expect.stringContaining("Acme"), expect.anything()),
    );

    await new Promise((resolve) => setTimeout(resolve, 1600));
    recognitionInstance.onresult?.({ results: [[{ transcript: "the second one" }] as never] });
    await waitFor(() =>
      expect(vi.mocked(speak)).toHaveBeenCalledWith(expect.stringContaining("Widgetco"), expect.anything()),
    );
  }, 10000);
});
