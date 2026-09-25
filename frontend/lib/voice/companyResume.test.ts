import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectCompanyResumeTrigger,
  cleanSlotAnswer,
  findJobByDetails,
  describeCompanyResumeResult,
} from "./companyResume";
import type { DashboardJob, LinkResumeRequestStatus } from "@/lib/dashboard/types";

describe("detectCompanyResumeTrigger", () => {
  it("detects a tailor-only trigger", () => {
    expect(detectCompanyResumeTrigger("tailor the resume")).toEqual({ sendTelegram: false });
  });

  it("detects a ready + telegram trigger", () => {
    expect(detectCompanyResumeTrigger("ready the resume and send it to my telegram channel")).toEqual({
      sendTelegram: true,
    });
  });

  it("treats 'linkedin' as meaning telegram", () => {
    expect(detectCompanyResumeTrigger("ready the resume and send it to my linkedin")).toEqual({ sendTelegram: true });
  });

  it("defers to the clipboard-link flow when the transcript mentions clipboard/copied", () => {
    expect(detectCompanyResumeTrigger("tailor the resume from the link I just copied")).toBeNull();
  });

  it("returns null without the word 'resume'", () => {
    expect(detectCompanyResumeTrigger("tailor Stripe")).toBeNull();
  });

  it("returns null for an unrelated question", () => {
    expect(detectCompanyResumeTrigger("what's the weather")).toBeNull();
  });
});

describe("cleanSlotAnswer", () => {
  it("trims and lowercases a plain answer", () => {
    expect(cleanSlotAnswer("Skyworks")).toBe("skyworks");
  });

  it("strips a leading filler word", () => {
    expect(cleanSlotAnswer("it's Skyworks")).toBe("skyworks");
    expect(cleanSlotAnswer("the role is Software Engineer")).toBe("software engineer");
  });

  it("returns null for a wildcard answer", () => {
    expect(cleanSlotAnswer("any")).toBeNull();
    expect(cleanSlotAnswer("doesn't matter")).toBeNull();
    expect(cleanSlotAnswer("Whatever")).toBeNull();
  });

  it("returns null for an empty answer", () => {
    expect(cleanSlotAnswer("   ")).toBeNull();
  });
});

describe("findJobByDetails", () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockJobsSearch(byQuery: Record<string, DashboardJob[]>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const search = new URL(url, "http://x").searchParams.get("search") ?? "";
        return { ok: true, json: async () => ({ jobs: byQuery[search] ?? [] }) };
      }),
    );
  }

  const swe: DashboardJob = {
    id: 1,
    company: "Skyworks",
    role: "Software Engineer",
    location: "Irvine, CA",
    apply_url: "https://skyworks.com/jobs/1",
  } as DashboardJob;
  const aiIntern: DashboardJob = {
    id: 2,
    company: "Skyworks",
    role: "AI/ML Summer Intern",
    location: "Irvine, CA",
    apply_url: "https://skyworks.com/jobs/2",
  } as DashboardJob;
  const remoteRole: DashboardJob = {
    id: 3,
    company: "Skyworks",
    role: "Data Analyst",
    location: "Remote",
    apply_url: "https://skyworks.com/jobs/3",
  } as DashboardJob;

  it("picks the job matching both role and location when all three are given", async () => {
    mockJobsSearch({ skyworks: [swe, aiIntern, remoteRole] });
    const result = await findJobByDetails("skyworks", "intern", "irvine");
    expect(result).toEqual(aiIntern);
  });

  it("falls back to matching just the role when location doesn't narrow further", async () => {
    mockJobsSearch({ skyworks: [swe, aiIntern, remoteRole] });
    const result = await findJobByDetails("skyworks", "data analyst", "nowhere real");
    expect(result).toEqual(remoteRole);
  });

  it("ignores a null (wildcard) role/location and falls back to the first company match", async () => {
    mockJobsSearch({ skyworks: [swe, aiIntern, remoteRole] });
    const result = await findJobByDetails("skyworks", null, null);
    expect(result).toEqual(swe);
  });

  it("falls back to the words mashed together when speech-to-text splits a one-word company", async () => {
    const job = { id: 4, company: "Robinhood", apply_url: "https://robinhood.com/jobs/1" } as DashboardJob;
    mockJobsSearch({ "robin hood": [], robinhood: [job] });
    const result = await findJobByDetails("robin hood", null, null);
    expect(result).toEqual(job);
  });

  it("returns null when nothing matches at all", async () => {
    mockJobsSearch({});
    expect(await findJobByDetails("nowhere", null, null)).toBeNull();
  });

  it("excludes jobs without an apply_url", async () => {
    const noUrl = { id: 5, company: "Skyworks", role: "X", location: "Y", apply_url: null } as DashboardJob;
    mockJobsSearch({ skyworks: [noUrl] });
    expect(await findJobByDetails("skyworks", null, null)).toBeNull();
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
    expect(
      describeCompanyResumeResult({ ...base, status: "failed", error: "no resume for that domain" }, false, "Stripe"),
    ).toBe("no resume for that domain");
  });
});
