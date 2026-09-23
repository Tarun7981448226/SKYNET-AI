import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMorningBriefing, getMorningBriefing } from "./morningBriefing";
import type { DashboardStats } from "@/lib/dashboard/types";

function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    applied: 0,
    rejected: 0,
    pending: 0,
    strongMatches: 0,
    mediumMatches: 0,
    lowMatches: 0,
    newToday: 0,
    resumesReady: 0,
    ...overrides,
  };
}

describe("buildMorningBriefing", () => {
  it("combines the greeting with the job-status sentence when nothing else is actionable", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats());
    expect(text).toBe(
      "Good morning, Mr. Tarun. SKYNET didn't find any new jobs today, and none of them look like a strong fit for your background yet.",
    );
  });

  it("appends a pending clause, singular", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats({ pending: 1 }));
    expect(text).toContain("1 job is still waiting on your decision.");
  });

  it("appends a pending clause, plural", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats({ pending: 3 }));
    expect(text).toContain("3 jobs are still waiting on your decision.");
  });

  it("appends a resumes-ready clause, singular", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats({ resumesReady: 1 }));
    expect(text).toContain("1 tailored resume is ready to send.");
  });

  it("appends a resumes-ready clause, plural", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats({ resumesReady: 2 }));
    expect(text).toContain("2 tailored resumes are ready to send.");
  });

  it("joins both extra clauses with 'and' when both apply", () => {
    const text = buildMorningBriefing("Good morning, Mr. Tarun.", makeStats({ pending: 2, resumesReady: 1 }));
    expect(text).toContain("2 jobs are still waiting on your decision, and 1 tailored resume is ready to send.");
  });

  it("omits the extras sentence entirely when pending and resumesReady are both zero", () => {
    const text = buildMorningBriefing("Good evening, Mr. Tarun.", makeStats({ newToday: 5, strongMatches: 2 }));
    expect(text.endsWith("background.")).toBe(true);
  });
});

describe("getMorningBriefing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches stats and builds a real briefing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => makeStats({ newToday: 4, strongMatches: 1, pending: 2 }),
      })),
    );
    const text = await getMorningBriefing("Good morning, Mr. Tarun.");
    expect(text).toContain("SKYNET found 4 new jobs today");
    expect(text).toContain("2 jobs are still waiting on your decision.");
  });

  it("falls back to the plain greeting on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const text = await getMorningBriefing("Good morning, Mr. Tarun.");
    expect(text).toBe("Good morning, Mr. Tarun.");
  });

  it("falls back to the plain greeting when the response carries an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "db down" }) })),
    );
    const text = await getMorningBriefing("Good morning, Mr. Tarun.");
    expect(text).toBe("Good morning, Mr. Tarun.");
  });

  it("falls back to the plain greeting when fetch itself throws, instead of rejecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const text = await getMorningBriefing("Good morning, Mr. Tarun.");
    expect(text).toBe("Good morning, Mr. Tarun.");
  });
});
