import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobFeed } from "./JobFeed";
import { DEFAULT_FILTERS } from "@/lib/dashboard/types";
import type { DashboardJob } from "@/lib/dashboard/types";

function makeJob(overrides: Partial<DashboardJob> = {}): DashboardJob {
  return {
    id: 1,
    company: "Datadog",
    role: "Senior Applied Scientist",
    type: "full-time",
    location: "New York, NY",
    domain: "ai_ml",
    user_decision: null,
    status: "tailored",
    apply_url: null,
    posted_date: null,
    created_at: "2026-09-19T00:00:00.000Z",
    score: 82,
    gaps: null,
    visa_flag: false,
    drive_link: null,
    source: "greenhouse:datadog",
    ...overrides,
  };
}

describe("JobFeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state, then the fetched jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ jobs: [makeJob()] }) }),
    );
    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} />);

    expect(screen.getByText("Loading jobs…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Senior Applied Scientist")).toBeInTheDocument());
  });

  it("shows an empty-state message when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ jobs: [] }) }));
    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("No jobs match these filters.")).toBeInTheDocument());
  });

  it("shows the server's error message instead of the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ error: "Not authenticated" }) }),
    );
    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("Not authenticated")).toBeInTheDocument());
  });

  it("optimistically applies a decision, and notifies the parent on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ jobs: [makeJob()] }) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // decision POST
    vi.stubGlobal("fetch", fetchMock);
    const onDecisionMade = vi.fn();
    const user = userEvent.setup();

    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} onDecisionMade={onDecisionMade} />);
    await waitFor(() => expect(screen.getByText("Senior Applied Scientist")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(onDecisionMade).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/jobs/1/decision",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reverts the optimistic update if the decision request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ jobs: [makeJob()] }) }) // initial load
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "db down" }) }); // decision POST fails
    vi.stubGlobal("fetch", fetchMock);
    const onDecisionMade = vi.fn();
    const user = userEvent.setup();

    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} onDecisionMade={onDecisionMade} />);
    await waitFor(() => expect(screen.getByText("Senior Applied Scientist")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Apply" }));

    // Reverted: Apply is enabled again (not stuck disabled as "already applied"),
    // and the parent was never told to refresh stats for a decision that failed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled());
    expect(onDecisionMade).not.toHaveBeenCalled();
  });

  it("groups the All tab into branches by source, not a flat list", async () => {
    const jobs = [
      makeJob({ id: 1, company: "Datadog", role: "SWE", source: "greenhouse:datadog" }),
      makeJob({ id: 2, company: "Anduril", role: "MLE", source: "lever:anduril" }),
      makeJob({ id: 3, company: "Acme", role: "PM", source: "gmail_linkedin" }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ jobs }) }));
    render(<JobFeed filters={DEFAULT_FILTERS} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("SWE")).toBeInTheDocument());
    expect(screen.getByText("Greenhouse")).toBeInTheDocument();
    expect(screen.getByText("Lever")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn Alerts")).toBeInTheDocument();
  });

  it("does not group into branches on a non-All tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ jobs: [makeJob({ source: "gmail_linkedin" })] }) }),
    );
    render(<JobFeed filters={{ ...DEFAULT_FILTERS, decision: "pending" }} refreshKey={0} />);

    await waitFor(() => expect(screen.getByText("Senior Applied Scientist")).toBeInTheDocument());
    expect(screen.queryByText("LinkedIn Alerts")).not.toBeInTheDocument();
  });
});
