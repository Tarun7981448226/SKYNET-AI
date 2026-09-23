import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isTopMatchQuery,
  isPendingQuery,
  parseDomainQuery,
  parseDecisionCommand,
  parseOrdinal,
  parseOrdinalDecisionCommand,
  describeJob,
  buildTopMatchAnswer,
  buildPendingAnswer,
  buildDomainAnswer,
  fetchTopMatch,
  postDecision,
} from "./jobFeed";
import type { DashboardJob } from "@/lib/dashboard/types";

function makeJob(overrides: Partial<DashboardJob> = {}): DashboardJob {
  return {
    id: 1,
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
    score: 80,
    gaps: null,
    visa_flag: null,
    drive_link: null,
    source: "greenhouse:acme",
    ...overrides,
  };
}

describe("matchers", () => {
  it.each(["read me my best match", "read me my top match", "what's my best match"])(
    "isTopMatchQuery matches %j",
    (t) => expect(isTopMatchQuery(t)).toBe(true),
  );
  it("isTopMatchQuery rejects unrelated text", () => expect(isTopMatchQuery("what's the weather")).toBe(false));

  it.each(["what's still pending", "what's pending", "anything pending"])("isPendingQuery matches %j", (t) =>
    expect(isPendingQuery(t)).toBe(true),
  );

  it("parseDomainQuery reads AI/ML jobs", () => {
    expect(parseDomainQuery("any AI/ML jobs today")).toBe("ai_ml");
  });
  it("parseDomainQuery reads SWE jobs", () => {
    expect(parseDomainQuery("any software jobs?")).toBe("swe");
  });
  it("parseDomainQuery returns null without both 'any' and 'jobs'", () => {
    expect(parseDomainQuery("tell me about AI")).toBeNull();
  });

  it("parseDecisionCommand reads 'mark that applied'", () => {
    expect(parseDecisionCommand("mark that applied")).toBe("applied");
  });
  it("parseDecisionCommand reads 'apply to that'", () => {
    expect(parseDecisionCommand("apply to that")).toBe("applied");
  });
  it("parseDecisionCommand reads 'reject it'", () => {
    expect(parseDecisionCommand("reject it")).toBe("rejected");
  });
  it("parseDecisionCommand requires a referent", () => {
    expect(parseDecisionCommand("applied")).toBeNull();
  });

  it.each([
    ["the third one down", 3],
    ["the second one", 2],
    ["number 2", 2],
    ["the 1st one", 1],
    ["mark the third one applied", 3],
  ])("parseOrdinal reads %j as %d", (t, n) => {
    expect(parseOrdinal(t)).toBe(n);
  });
  it("parseOrdinal rejects unrelated text", () => {
    expect(parseOrdinal("what's the weather")).toBeNull();
  });
  it("parseOrdinal rejects an out-of-range digit", () => {
    expect(parseOrdinal("number 9")).toBeNull();
  });

  it("parseOrdinalDecisionCommand reads 'mark the third one applied'", () => {
    expect(parseOrdinalDecisionCommand("mark the third one applied")).toEqual({ ordinal: 3, decision: "applied" });
  });
  it("parseOrdinalDecisionCommand reads 'reject the second one'", () => {
    expect(parseOrdinalDecisionCommand("reject the second one")).toEqual({ ordinal: 2, decision: "rejected" });
  });
  it("parseOrdinalDecisionCommand returns null without an ordinal", () => {
    expect(parseOrdinalDecisionCommand("mark that applied")).toBeNull();
  });
  it("parseOrdinalDecisionCommand returns null without a decision word", () => {
    expect(parseOrdinalDecisionCommand("the third one down")).toBeNull();
  });
});

describe("builders", () => {
  it("describeJob", () => {
    expect(describeJob(makeJob({ role: "SWE", company: "Acme" }))).toBe("the SWE role at Acme");
  });

  it("buildTopMatchAnswer with a job", () => {
    expect(buildTopMatchAnswer(makeJob({ role: "SWE", company: "Acme", score: 91 }))).toBe(
      "Your best match is SWE at Acme, score 91.",
    );
  });
  it("buildTopMatchAnswer with none", () => {
    expect(buildTopMatchAnswer(null)).toContain("don't have any scored matches");
  });

  it("buildPendingAnswer lists up to 3", () => {
    const jobs = [makeJob({ id: 1, role: "A", company: "X" }), makeJob({ id: 2, role: "B", company: "Y" })];
    expect(buildPendingAnswer(jobs)).toBe("You have 2 jobs pending: A at X, and B at Y.");
  });
  it("buildPendingAnswer with none", () => {
    expect(buildPendingAnswer([])).toContain("Nothing pending");
  });

  it("buildDomainAnswer with none", () => {
    expect(buildDomainAnswer([])).toContain("No jobs in that domain");
  });
});

describe("fetchTopMatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("picks the highest-scored job from the feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          jobs: [makeJob({ id: 1, score: 60 }), makeJob({ id: 2, score: 95 }), makeJob({ id: 3, score: 70 })],
        }),
      })),
    );
    const top = await fetchTopMatch();
    expect(top?.id).toBe(2);
  });

  it("returns null when nothing is scored yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [makeJob({ score: null })] }) })));
    expect(await fetchTopMatch()).toBeNull();
  });
});

describe("postDecision", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the decision and reports success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await postDecision(5, "applied");
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/jobs/5/decision",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reports failure on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await postDecision(5, "rejected")).toBe(false);
  });
});
