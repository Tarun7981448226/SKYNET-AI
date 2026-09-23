import { afterEach, describe, expect, it, vi } from "vitest";

import { isScoreClipboardCommand, extractUrl, submitLink, pollLinkResumeOnce, describeLinkResumeResult } from "./clipboardLink";
import type { LinkResumeRequestStatus } from "@/lib/dashboard/types";

describe("isScoreClipboardCommand", () => {
  it.each(["score the link I just copied", "score that link", "score my clipboard job", "tailor that job link"])(
    "matches %j",
    (t) => expect(isScoreClipboardCommand(t)).toBe(true),
  );
  it("rejects an unrelated question", () => {
    expect(isScoreClipboardCommand("what's the weather")).toBe(false);
  });
});

describe("extractUrl", () => {
  it("pulls a bare URL out of clipboard text", () => {
    expect(extractUrl("https://boards.greenhouse.io/acme/jobs/123")).toBe(
      "https://boards.greenhouse.io/acme/jobs/123",
    );
  });
  it("strips trailing punctuation", () => {
    expect(extractUrl("check this out: https://example.com/job.")).toBe("https://example.com/job");
  });
  it("returns null when there's no URL", () => {
    expect(extractUrl("just some copied text")).toBeNull();
  });
});

describe("submitLink", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a requestId on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ requestId: 42 }) })));
    expect(await submitLink("https://x.com/job")).toEqual({ requestId: 42 });
  });

  it("returns the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "bad url" }) })));
    expect(await submitLink("https://x.com/job")).toEqual({ error: "bad url" });
  });

  it("returns a fallback error when the fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await submitLink("https://x.com/job")).toEqual({ error: "Couldn't reach the server. Try again." });
  });
});

describe("pollLinkResumeOnce", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed status on success", async () => {
    const status: LinkResumeRequestStatus = {
      id: 1,
      status: "done",
      score: 88,
      drive_link: null,
      whatsapp_status: "sent",
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => status })));
    expect(await pollLinkResumeOnce(1)).toEqual(status);
  });

  it("returns null on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await pollLinkResumeOnce(1)).toBeNull();
  });
});

describe("describeLinkResumeResult", () => {
  it("speaks the score and delivery status when done", () => {
    const text = describeLinkResumeResult({
      id: 1,
      status: "done",
      score: 88,
      drive_link: null,
      whatsapp_status: "sent",
      error: null,
    });
    expect(text).toBe("Fit score 88. Sent to Telegram.");
  });

  it("speaks the error when failed", () => {
    const text = describeLinkResumeResult({
      id: 1,
      status: "failed",
      score: null,
      drive_link: null,
      whatsapp_status: null,
      error: "couldn't parse that posting",
    });
    expect(text).toBe("couldn't parse that posting");
  });
});
