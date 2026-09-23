import { describe, expect, it } from "vitest";

import { sourceGroup, sourceLabel } from "./sourceLabels";

describe("sourceGroup", () => {
  it("strips a company/channel suffix", () => {
    expect(sourceGroup("greenhouse:robinhood")).toBe("greenhouse");
    expect(sourceGroup("telegram:somechannel")).toBe("telegram");
  });

  it("passes through a source with no suffix", () => {
    expect(sourceGroup("gmail_linkedin")).toBe("gmail_linkedin");
  });
});

describe("sourceLabel", () => {
  it.each([
    ["greenhouse:robinhood", "Greenhouse"],
    ["lever:anduril", "Lever"],
    ["telegram:somechannel", "Telegram Channels"],
    ["share_bot", "Shared via Telegram"],
    ["gmail_linkedin", "LinkedIn Alerts"],
    ["link_paste", "Pasted Links"],
  ])("labels %j as %j", (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });

  it("falls back to the raw group name for an unknown source", () => {
    expect(sourceLabel("future_source:x")).toBe("future_source");
  });
});
