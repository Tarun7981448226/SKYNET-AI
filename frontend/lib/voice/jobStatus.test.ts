import { afterEach, describe, expect, it, vi } from "vitest";

import { isJobStatusQuery, buildJobStatus, getJobStatus } from "./jobStatus";
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

describe("isJobStatusQuery", () => {
  it.each(["job status", "what's my job status", "status of my jobs", "how's the job search going"])(
    "matches %j",
    (transcript) => {
      expect(isJobStatusQuery(transcript)).toBe(true);
    },
  );

  it("does not match an unrelated question", () => {
    expect(isJobStatusQuery("what's the weather today")).toBe(false);
  });
});

describe("buildJobStatus", () => {
  it("reports today's count and good-fit count (strong + medium)", () => {
    const text = buildJobStatus(makeStats({ newToday: 7, strongMatches: 2, mediumMatches: 3 }));
    expect(text).toContain("SKYNET found 7 new jobs today");
    expect(text).toContain("5 of them look like a good fit");
  });

  it("uses singular phrasing for exactly one", () => {
    const text = buildJobStatus(makeStats({ newToday: 1, strongMatches: 1, mediumMatches: 0 }));
    expect(text).toContain("SKYNET found 1 new job today");
    expect(text).toContain("1 of them looks like a good fit");
  });

  it("says nothing looked like a good fit when there are none", () => {
    const text = buildJobStatus(makeStats({ newToday: 3 }));
    expect(text).toContain("none of them look like a strong fit");
  });

  it("says no new jobs when there's genuinely nothing today", () => {
    const text = buildJobStatus(makeStats());
    expect(text).toContain("SKYNET didn't find any new jobs today");
  });
});

describe("getJobStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches live stats and builds the spoken answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => makeStats({ newToday: 2, strongMatches: 1 }) })),
    );
    const text = await getJobStatus();
    expect(text).toContain("SKYNET found 2 new jobs today");
  });

  it("reports it couldn't reach stats on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const text = await getJobStatus();
    expect(text).toContain("couldn't reach");
  });
});
