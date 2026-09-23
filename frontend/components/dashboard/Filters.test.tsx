import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Filters } from "./Filters";
import { DEFAULT_FILTERS } from "@/lib/dashboard/types";

describe("Filters", () => {
  it("switches the decision filter when a pill is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Filters filters={DEFAULT_FILTERS} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Applied" }));

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, decision: "applied" });
  });

  it("updates minScore as a number, or null when cleared", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Filters filters={DEFAULT_FILTERS} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("Min score"), "7");
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, minScore: 7 });
  });

  it("updates the search text as typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Filters filters={DEFAULT_FILTERS} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("Search company or role"), "a");
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, search: "a" });
  });

  it("updates the domain via the select", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Filters filters={DEFAULT_FILTERS} onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Domain" }), "swe");
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, domain: "swe" });
  });

  it("updates the source via the select", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Filters filters={DEFAULT_FILTERS} onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Source" }), "gmail_linkedin");
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, source: "gmail_linkedin" });
  });
});
