import { afterEach, describe, expect, it, vi } from "vitest";

import { handlePublicTranscript } from "./publicAssistant";
import { askPublicQuestion } from "./publicQa";

vi.mock("./weather", () => ({ getWeather: vi.fn(async (place: string | null) => `weather:${place ?? "here"}`) }));
vi.mock("./publicQa", () => ({ askPublicQuestion: vi.fn(async (q: string) => `answer:${q}`) }));

function makeCtx(questionsAskedSoFar = 0) {
  return { showLogin: vi.fn(), questionsAskedSoFar };
}

describe("handlePublicTranscript", () => {
  afterEach(() => {
    vi.mocked(askPublicQuestion).mockClear();
  });

  it("mutes without calling any agent", async () => {
    const ctx = makeCtx();
    const outcome = await handlePublicTranscript("mute", ctx);
    expect(outcome).toEqual({ kind: "muted" });
    expect(ctx.showLogin).not.toHaveBeenCalled();
  });

  it("defers navigating to the sign-in page until the message finishes speaking", async () => {
    const ctx = makeCtx();
    const outcome = await handlePublicTranscript("sign in", ctx);
    expect(ctx.showLogin).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("action");
    if (outcome.kind === "action") {
      expect(outcome.after).toBe(ctx.showLogin);
      outcome.after?.();
    }
    expect(ctx.showLogin).toHaveBeenCalledTimes(1);
  });

  it.each(["I need access", "show me the sign in tab", "can you log me in"])(
    "recognizes %j as a request to sign in",
    async (transcript) => {
      const ctx = makeCtx();
      const outcome = await handlePublicTranscript(transcript, ctx);
      expect(outcome.kind).toBe("action");
      if (outcome.kind === "action") outcome.after?.();
      expect(ctx.showLogin).toHaveBeenCalledTimes(1);
    },
  );

  it("routes a weather question to the weather agent", async () => {
    const outcome = await handlePublicTranscript("what's the weather in Tokyo", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "weather:tokyo" });
  });

  it.each(["who are you", "what are you", "what do you do", "Who is SKYNET?"])(
    "triggers the narrated presentation for %j, not a plain answer or Gemini",
    async (transcript) => {
      const outcome = await handlePublicTranscript(transcript, makeCtx());
      expect(outcome).toEqual({ kind: "presentation" });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    },
  );

  it.each(["who made you", "who built you", "who created you"])(
    "answers %j with the fixed creator script, not Gemini",
    async (transcript) => {
      const outcome = await handlePublicTranscript(transcript, makeCtx());
      expect(outcome).toEqual({ kind: "spoken", text: "Tarun built me, as his own personal project." });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    },
  );

  it.each(["who is tarun", "who's tarun", "where is tarun from", "what does tarun do", "tell me about tarun"])(
    "shows the Tarun bio card for %j, not the SKYNET presentation or Gemini",
    async (transcript) => {
      const outcome = await handlePublicTranscript(transcript, makeCtx());
      expect(outcome).toMatchObject({ kind: "bio", spokenIntro: expect.stringContaining("Tarun") });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    },
  );

  it("does not confuse 'who are you' (SKYNET) with 'who is Tarun' (the person)", async () => {
    const skynet = await handlePublicTranscript("who are you", makeCtx());
    const tarun = await handlePublicTranscript("who is Tarun", makeCtx());
    expect(skynet.kind).toBe("presentation");
    expect(tarun.kind).toBe("bio");
  });

  it("ignores a single stray word instead of sending it to the restricted Q&A endpoint", async () => {
    const outcome = await handlePublicTranscript("the", makeCtx());
    expect(outcome).toEqual({ kind: "ignored" });
    expect(askPublicQuestion).not.toHaveBeenCalled();
  });

  it.each(["hi", "hey", "hi!", "hey there"])(
    "replies to the bare greeting %j directly, not via Gemini",
    async (transcript) => {
      const outcome = await handlePublicTranscript(transcript, makeCtx());
      expect(outcome).toEqual({ kind: "spoken", text: "Hello!" });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    },
  );

  it.each(["hello", "hello SKYNET"])(
    "opens the name-and-options conversation flow for %j, not a plain reply or Gemini",
    async (transcript) => {
      const outcome = await handlePublicTranscript(transcript, makeCtx());
      expect(outcome).toEqual({ kind: "hello" });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    },
  );

  it("does not spend a quota slot on a bare greeting", async () => {
    const outcome = await handlePublicTranscript("hi", makeCtx(10));
    expect(outcome).toEqual({ kind: "spoken", text: "Hello!" });
  });

  it("does not spend a quota slot on 'hello' either", async () => {
    const outcome = await handlePublicTranscript("hello", makeCtx(10));
    expect(outcome).toEqual({ kind: "hello" });
  });

  it("still routes a longer sentence that happens to start with a greeting word to the real request", async () => {
    const outcome = await handlePublicTranscript("hi what's the weather", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "weather:here" });
  });

  it("falls back to the restricted public Q&A agent for anything else", async () => {
    const outcome = await handlePublicTranscript("are you a human", makeCtx());
    expect(outcome).toEqual({ kind: "spoken", text: "answer:are you a human" });
    expect(askPublicQuestion).toHaveBeenCalledTimes(1);
  });

  describe("per-session question quota", () => {
    it("answers normally under the limit", async () => {
      const outcome = await handlePublicTranscript("who are you", makeCtx(9));
      expect(outcome).toEqual({ kind: "presentation" });
    });

    it("refuses with the limit message at the cap, without spending a Gemini call", async () => {
      const outcome = await handlePublicTranscript("are you a human", makeCtx(10));
      expect(outcome).toEqual({
        kind: "spoken",
        text: "You've reached your limit of questions to SKYNET for this visit — reload the page for ten more.",
      });
      expect(askPublicQuestion).not.toHaveBeenCalled();
    });

    it("still refuses the presentation at the cap", async () => {
      const outcome = await handlePublicTranscript("who are you", makeCtx(10));
      expect(outcome).toMatchObject({ kind: "spoken", text: expect.stringContaining("reached your limit") });
    });

    it("still refuses a weather question at the cap, without calling the weather agent", async () => {
      const { getWeather } = await import("./weather");
      const outcome = await handlePublicTranscript("what's the weather", makeCtx(15));
      expect(outcome).toMatchObject({ text: expect.stringContaining("reached your limit") });
      expect(getWeather).not.toHaveBeenCalled();
    });

    it("still lets sign-in through even after the quota is spent", async () => {
      const ctx = makeCtx(20);
      const outcome = await handlePublicTranscript("sign in", ctx);
      expect(outcome.kind).toBe("action");
      if (outcome.kind === "action") outcome.after?.();
      expect(ctx.showLogin).toHaveBeenCalledTimes(1);
    });

    it("still mutes even after the quota is spent", async () => {
      const outcome = await handlePublicTranscript("mute", makeCtx(20));
      expect(outcome).toEqual({ kind: "muted" });
    });
  });
});
