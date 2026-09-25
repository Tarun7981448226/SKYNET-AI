import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCompanyResumeCommand, findJobByCompany, describeCompanyResumeResult } from "./companyResume";
import type { DashboardJob, LinkResumeRequestStatus } from "@/lib/dashboard/types";

describe("parseCompanyResumeCommand", () => {
  it("parses a tailor-only command and extracts the company", () => {
    expect(parseCompanyResumeCommand("tailor the resume for Stripe")).toEqual({
      company: "stripe",
      sendTelegram: false,
    });
  });

  it("parses a ready + telegram command", () => {
    expect(parseCompanyResumeCommand("ready the resume for Stripe and send it to my telegram channel")).toEqual({
      company: "stripe",
      sendTelegram: true,
    });
  });

  it("treats 'linkedin' in a delivery phrase as meaning telegram", () => {
    const result = parseCompanyResumeCommand("ready the resume for Unity and send it to my linkedin");
    expect(result).toEqual({ company: "unity", sendTelegram: true });
  });

  it("defers to the clipboard-link flow when the transcript mentions clipboard/copied", () => {
    expect(parseCompanyResumeCommand("tailor the resume from the link I just copied")).toBeNull();
  });

  it("returns null without the word 'resume'", () => {
    expect(parseCompanyResumeCommand("tailor Stripe")).toBeNull();
  });

  it("returns null for an unrelated question", () => {
    expect(parseCompanyResumeCommand("what's the weather")).toBeNull();
  });
});

describe("findJobByCompany", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the first job with an apply_url", async () => {
    const job = { id: 1, company: "Stripe", apply_url: "https://stripe.com/jobs/1" } as DashboardJob;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [job] }) })));
    expect(await findJobByCompany("stripe")).toEqual(job);
  });

  it("returns null when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [] }) })));
    expect(await findJobByCompany("nowhere")).toBeNull();
  });

  it("returns null on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await findJobByCompany("stripe")).toBeNull();
  });
});

describe("describeCompanyResumeResult", () => {
  const base: LinkResumeRequestStatus = {
    id: 1,
    status: "done",
    score: 91,
    drive_link: null,
    whatsapp_status: null,
    error: null,
  };

  it("mentions the pending dashboard when tailor-only", () => {
    expect(describeCompanyResumeResult(base, false, "Stripe")).toBe(
      "Stripe resume tailored, fit score 91. It's in your pending dashboard now.",
    );
  });

  it("confirms Telegram delivery when requested and sent", () => {
    expect(describeCompanyResumeResult({ ...base, whatsapp_status: "sent" }, true, "Stripe")).toBe(
      "Stripe resume ready, fit score 91. Sent to your Telegram.",
    );
  });

  it("flags a failed Telegram delivery when requested", () => {
    expect(describeCompanyResumeResult({ ...base, whatsapp_status: "failed: no token" }, true, "Stripe")).toBe(
      "Stripe resume ready, fit score 91. Telegram delivery failed — check the dashboard.",
    );
  });

  it("speaks the error when the request failed", () => {
    expect(describeCompanyResumeResult({ ...base, status: "failed", error: "no resume for that domain" }, false, "Stripe")).toBe(
      "no resume for that domain",
    );
  });
});
