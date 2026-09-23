import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JobCard } from "./JobCard";
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
    apply_url: "https://example.com/apply",
    posted_date: "2026-09-15",
    created_at: "2026-09-19T00:00:00.000Z",
    score: 82,
    gaps: null,
    visa_flag: false,
    drive_link: "https://drive.google.com/file/resume",
    source: "greenhouse:datadog",
    ...overrides,
  };
}

describe("JobCard", () => {
  it("renders the job's core details", () => {
    render(<JobCard job={makeJob()} onDecision={vi.fn()} />);
    expect(screen.getByText("Senior Applied Scientist")).toBeInTheDocument();
    expect(screen.getByText(/Datadog/)).toBeInTheDocument();
    expect(screen.getByText(/New York, NY/)).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("shows a dash instead of a number when there's no score yet", () => {
    render(<JobCard job={makeJob({ score: null })} onDecision={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("calls onDecision with 'applied' when Apply is clicked", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<JobCard job={makeJob()} onDecision={onDecision} />);

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onDecision).toHaveBeenCalledWith(1, "applied");
  });

  it("calls onDecision with 'rejected' when Reject is clicked", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<JobCard job={makeJob()} onDecision={onDecision} />);

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(onDecision).toHaveBeenCalledWith(1, "rejected");
  });

  it("disables Apply once already applied, but keeps Reject usable", () => {
    render(<JobCard job={makeJob({ user_decision: "applied" })} onDecision={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
    expect(screen.getByText("applied")).toBeInTheDocument();
  });

  it("disables Reject once already rejected, but keeps Apply usable", () => {
    render(<JobCard job={makeJob({ user_decision: "rejected" })} onDecision={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
  });

  it("only shows a View Resume link when a drive_link exists", () => {
    const { rerender } = render(<JobCard job={makeJob({ drive_link: null })} onDecision={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "View Resume" })).not.toBeInTheDocument();

    rerender(<JobCard job={makeJob({ drive_link: "https://drive.google.com/x" })} onDecision={vi.fn()} />);
    expect(screen.getByRole("link", { name: "View Resume" })).toHaveAttribute(
      "href",
      "https://drive.google.com/x",
    );
  });

  it("flags a visa-restricted posting", () => {
    render(<JobCard job={makeJob({ visa_flag: true })} onDecision={vi.fn()} />);
    expect(screen.getByText("visa flag")).toBeInTheDocument();
  });
});
