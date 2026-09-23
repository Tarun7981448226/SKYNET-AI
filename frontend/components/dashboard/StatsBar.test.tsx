import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatsBar } from "./StatsBar";
import type { DashboardStats } from "@/lib/dashboard/types";

describe("StatsBar", () => {
  it("renders every stat with its label", () => {
    const stats: DashboardStats = {
      applied: 2,
      rejected: 3,
      pending: 26,
      strongMatches: 1,
      mediumMatches: 11,
      lowMatches: 42,
      newToday: 88,
      resumesReady: 20,
    };
    render(<StatsBar stats={stats} />);

    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("New Today")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Strong Matches")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("Resumes Ready")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
});
