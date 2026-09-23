import { afterEach, describe, expect, it, vi } from "vitest";

import { handleTranscript } from "./assistant";
import { askQuestion } from "./qa";

vi.mock("./weather", () => ({ getWeather: vi.fn(async (place: string | null) => `weather:${place ?? "here"}`) }));
vi.mock("./news", () => ({ getNews: vi.fn(async (topic: string | null) => `news:${topic ?? "top"}`) }));
vi.mock("./qa", () => ({ askQuestion: vi.fn(async (q: string) => `answer:${q}`) }));
vi.mock("./jobStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jobStatus")>();
  return { ...actual, getJobStatus: vi.fn(async () => "job-status-answer") };
});
vi.mock("./statsQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./statsQueries")>();
  return {
    ...actual,
    getNewTodayAnswer: vi.fn(async () => "new-today-answer"),
    getAppliedCountAnswer: vi.fn(async () => "applied-count-answer"),
    getStrongMatchAnswer: vi.fn(async () => "strong-match-answer"),
    getResumesReadyAnswer: vi.fn(async () => "resumes-ready-answer"),
  };
});
vi.mock("./jobFeed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jobFeed")>();
  return {
    ...actual,
    fetchTopMatch: vi.fn(),
    fetchPending: vi.fn(async () => []),
    fetchByDomain: vi.fn(async () => []),
  };
});

const SAMPLE_JOB = {
  id: 7,
  company: "Acme",
  role: "Software Engineer",
  type: null,
  location: null,
  domain: null,
  user_decision: null,
  status: "tailored",
  apply_url: null,
  posted_date: null,
  created_at: new Date().toISOString(),
  score: 91,
  gaps: null,
  visa_flag: null,
  drive_link: null,
  source: "greenhouse:acme",
};

function makeCtx() {
  return { signOut: vi.fn(), closeTab: vi.fn(), showDashboard: vi.fn(), hideDashboard: vi.fn() };
}

describe("handleTranscript", () => {
  it("mutes without calling any agent", async () => {
    const ctx = makeCtx();
    const outcome = await handleTranscript("mute", ctx);
    expect(outcome).toEqual({ kind: "muted" });
    expect(ctx.signOut).not.toHaveBeenCalled();
  });

  it("defers sign-out until the farewell finishes speaking, not immediately", async () => {
    const ctx = makeCtx();
    const outcome = await handleTranscript("sign out", ctx);
    expect(ctx.signOut).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("action");
    if (outcome.kind === "action") {
      expect(outcome.after).toBe(ctx.signOut);
      outcome.after?.();
    }
    expect(ctx.signOut).toHaveBeenCalledTimes(1);
  });

  it("attempts to close the tab and reports the browser limitation", async () => {
    const ctx = makeCtx();
    const outcome = await handleTranscript("close the tab", ctx);
    expect(ctx.closeTab).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "action", message: expect.stringContaining("Command W") });
  });

  it("routes a weather question to the weather agent", async () => {
    const outcome = await handleTranscript("what's the weather in Tokyo", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "weather:tokyo" });
  });

  it("routes a news question to the news agent", async () => {
    const outcome = await handleTranscript("what's the news about space", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "news:space" });
  });

  it("routes a job status question to the job status agent, not general Q&A", async () => {
    const outcome = await handleTranscript("what's my job status", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "job-status-answer" });
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("routes a stats query to statsQueries, not general Q&A", async () => {
    const outcome = await handleTranscript("how many jobs came in today", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "new-today-answer" });
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it("routes a top-match query and returns a job-mentioned outcome", async () => {
    const { fetchTopMatch } = await import("./jobFeed");
    vi.mocked(fetchTopMatch).mockResolvedValueOnce(SAMPLE_JOB);
    const outcome = await handleTranscript("read me my best match", makeCtx());
    expect(outcome).toEqual({
      kind: "job-mentioned",
      text: "Your best match is Software Engineer at Acme, score 91.",
      job: SAMPLE_JOB,
    });
  });

  it("falls back to a plain spoken outcome when there's no top match yet", async () => {
    const { fetchTopMatch } = await import("./jobFeed");
    vi.mocked(fetchTopMatch).mockResolvedValueOnce(null);
    const outcome = await handleTranscript("what's my top match", makeCtx());
    expect(outcome.kind).toBe("spoken");
  });

  it("routes a pending-jobs query to jobFeed but returns plain spoken when nothing's pending", async () => {
    const outcome = await handleTranscript("what's still pending", makeCtx());
    expect(outcome.kind).toBe("spoken");
  });

  it("returns a jobs-mentioned outcome carrying the list when pending jobs exist", async () => {
    const { fetchPending } = await import("./jobFeed");
    vi.mocked(fetchPending).mockResolvedValueOnce([SAMPLE_JOB]);
    const outcome = await handleTranscript("what's still pending", makeCtx());
    expect(outcome).toEqual({
      kind: "jobs-mentioned",
      text: expect.stringContaining("Software Engineer at Acme"),
      jobs: [SAMPLE_JOB],
    });
  });

  it("returns a jobs-mentioned outcome for a domain query when jobs exist", async () => {
    const { fetchByDomain } = await import("./jobFeed");
    vi.mocked(fetchByDomain).mockResolvedValueOnce([SAMPLE_JOB]);
    const outcome = await handleTranscript("any AI/ML jobs today", makeCtx());
    expect(outcome).toEqual({
      kind: "jobs-mentioned",
      text: expect.stringContaining("Software Engineer at Acme"),
      jobs: [SAMPLE_JOB],
    });
  });

  it("falls back to the general Q&A agent for anything else", async () => {
    const outcome = await handleTranscript("are you a human", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "answer:are you a human" });
  });

  it("shows the dashboard via the context callback", async () => {
    const ctx = makeCtx();
    const outcome = await handleTranscript("open the dashboard", ctx);
    expect(ctx.showDashboard).toHaveBeenCalledTimes(1);
    expect(ctx.hideDashboard).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "action", message: expect.stringContaining("Opening") });
  });

  it("hides the dashboard via the context callback, not confused with close-tab", async () => {
    const ctx = makeCtx();
    const outcome = await handleTranscript("close dashboard", ctx);
    expect(ctx.hideDashboard).toHaveBeenCalledTimes(1);
    expect(ctx.closeTab).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "action", message: expect.stringContaining("Hiding") });
  });

  describe("identity question", () => {
    afterEach(() => {
      vi.mocked(askQuestion).mockClear();
    });

    it.each(["who are you", "what are you", "what do you do", "Who is SKYNET?"])(
      "answers %j with the fixed identity script, not Gemini",
      async (transcript) => {
        const outcome = await handleTranscript(transcript, makeCtx());
        expect(outcome.kind).toBe("spoken");
        expect(outcome).toMatchObject({ text: expect.stringContaining("SKYNET") });
        expect(askQuestion).not.toHaveBeenCalled();
      },
    );
  });

  describe("noise filtering", () => {
    afterEach(() => {
      vi.mocked(askQuestion).mockClear();
    });

    it("ignores a single stray word instead of sending it to Gemini", async () => {
      const outcome = await handleTranscript("the", makeCtx());
      expect(outcome).toEqual({ kind: "ignored" });
      expect(askQuestion).not.toHaveBeenCalled();
    });

    it("still sends a real multi-word question to the Q&A agent", async () => {
      const outcome = await handleTranscript("are you a human", makeCtx());
      expect(outcome).toEqual({ kind: "spoken", text: "answer:are you a human" });
      expect(askQuestion).toHaveBeenCalledTimes(1);
    });
  });
});
