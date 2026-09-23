import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isNewTodayQuery,
  isAppliedCountQuery,
  isStrongMatchQuery,
  isResumesReadyQuery,
  buildNewTodayAnswer,
  buildAppliedCountAnswer,
  buildStrongMatchAnswer,
  buildResumesReadyAnswer,
  getNewTodayAnswer,
} from "./statsQueries";
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

describe("matchers", () => {
  it.each(["how many jobs came in today", "how many new jobs today", "any new jobs today"])(
    "isNewTodayQuery matches %j",
    (t) => expect(isNewTodayQuery(t)).toBe(true),
  );
  it("isNewTodayQuery rejects an unrelated question", () => {
    expect(isNewTodayQuery("what's the weather")).toBe(false);
  });

  it.each(["how many have I applied to", "how many jobs have i applied to", "applied count"])(
    "isAppliedCountQuery matches %j",
    (t) => expect(isAppliedCountQuery(t)).toBe(true),
  );

  it.each(["how many strong matches do I have", "how many strong matches"])("isStrongMatchQuery matches %j", (t) =>
    expect(isStrongMatchQuery(t)).toBe(true),
  );

  it.each(["are my resumes ready", "how many resumes are ready", "resumes ready"])(
    "isResumesReadyQuery matches %j",
    (t) => expect(isResumesReadyQuery(t)).toBe(true),
  );
});

describe("builders", () => {
  it("new today: zero vs plural vs singular", () => {
    expect(buildNewTodayAnswer(makeStats())).toContain("No new jobs");
    expect(buildNewTodayAnswer(makeStats({ newToday: 1 }))).toBe("1 new job came in today.");
    expect(buildNewTodayAnswer(makeStats({ newToday: 4 }))).toBe("4 new jobs came in today.");
  });

  it("applied count: zero vs plural", () => {
    expect(buildAppliedCountAnswer(makeStats())).toContain("haven't applied");
    expect(buildAppliedCountAnswer(makeStats({ applied: 3 }))).toBe("You've applied to 3 jobs.");
  });

  it("strong match: none, strong only, strong+medium", () => {
    expect(buildStrongMatchAnswer(makeStats())).toContain("No strong or medium");
    expect(buildStrongMatchAnswer(makeStats({ strongMatches: 2 }))).toBe("2 strong matches.");
    expect(buildStrongMatchAnswer(makeStats({ strongMatches: 2, mediumMatches: 1 }))).toBe(
      "2 strong and 1 medium match.",
    );
  });

  it("resumes ready: zero vs plural vs singular", () => {
    expect(buildResumesReadyAnswer(makeStats())).toContain("No resumes ready");
    expect(buildResumesReadyAnswer(makeStats({ resumesReady: 1 }))).toBe("1 resume is ready.");
    expect(buildResumesReadyAnswer(makeStats({ resumesReady: 2 }))).toBe("2 resumes are ready.");
  });
});

describe("getNewTodayAnswer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches live stats and builds the answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => makeStats({ newToday: 5 }) })));
    expect(await getNewTodayAnswer()).toBe("5 new jobs came in today.");
  });

  it("reports it couldn't reach stats on a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await getNewTodayAnswer()).toContain("couldn't reach");
  });
});
