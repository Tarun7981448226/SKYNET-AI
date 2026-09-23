import { describe, expect, it } from "vitest";

import { parseNewsQuery, parseVoiceCommand, parseWeatherQuery } from "./commands";

describe("parseVoiceCommand", () => {
  it.each([
    ["close", "close"],
    ["close tab", "close"],
    ["please close the tab", "close"],
    ["sign out", "sign-out"],
    ["signout", "sign-out"],
    ["log out please", "sign-out"],
    ["I am ending the session for today", "sign-out"],
    ["I'm done for today", "sign-out"],
    ["that's it for today", "sign-out"],
    ["mute", "mute"],
    ["stop", "mute"],
    ["pause", "mute"],
    ["be quiet", "mute"],
    ["open dashboard", "show-dashboard"],
    ["show the dashboard", "show-dashboard"],
    ["hide dashboard", "hide-dashboard"],
    ["close the dashboard", "hide-dashboard"],
    ["sign in", "show-login"],
    ["can you log me in", "show-login"],
    ["I need access", "show-login"],
    ["show me the sign in tab", "show-login"],
  ] as const)("recognizes %j as %s", (transcript, expected) => {
    expect(parseVoiceCommand(transcript)).toBe(expected);
  });

  it("prefers hide-dashboard over the generic close-tab phrase", () => {
    // "close dashboard" contains "close" as a substring — the longer,
    // more specific dashboard phrase must win, not the bare close-tab one.
    expect(parseVoiceCommand("close dashboard")).toBe("hide-dashboard");
  });

  it("returns null for unrecognized speech", () => {
    expect(parseVoiceCommand("what's the weather today")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseVoiceCommand("   ")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(parseVoiceCommand("SIGN OUT")).toBe("sign-out");
  });
});

describe("parseWeatherQuery", () => {
  it("recognizes a bare weather question with no place", () => {
    expect(parseWeatherQuery("how's the weather")).toEqual({ isWeatherQuery: true, place: null });
    expect(parseWeatherQuery("what's the weather")).toEqual({ isWeatherQuery: true, place: null });
  });

  it("extracts a named place after \"in\"", () => {
    expect(parseWeatherQuery("what's the weather in Tokyo")).toEqual({
      isWeatherQuery: true,
      place: "tokyo",
    });
  });

  it("strips a trailing time phrase after the place", () => {
    expect(parseWeatherQuery("what's the weather in New York right now")).toEqual({
      isWeatherQuery: true,
      place: "new york",
    });
  });

  it("returns isWeatherQuery: false for unrelated speech", () => {
    expect(parseWeatherQuery("sign out")).toEqual({ isWeatherQuery: false, place: null });
  });
});

describe("parseNewsQuery", () => {
  it("recognizes a bare news request with no topic", () => {
    expect(parseNewsQuery("what's the news")).toEqual({ isNewsQuery: true, topic: null });
    expect(parseNewsQuery("tell me the news")).toEqual({ isNewsQuery: true, topic: null });
  });

  it("extracts a topic after \"about\" or \"on\"", () => {
    expect(parseNewsQuery("what's the news about the stock market")).toEqual({
      isNewsQuery: true,
      topic: "the stock market",
    });
    expect(parseNewsQuery("news on artificial intelligence")).toEqual({
      isNewsQuery: true,
      topic: "artificial intelligence",
    });
  });

  it("extracts a place after \"in\"", () => {
    expect(parseNewsQuery("what's the news in India")).toEqual({
      isNewsQuery: true,
      topic: "india",
    });
  });

  it("returns isNewsQuery: false for unrelated speech", () => {
    expect(parseNewsQuery("what's the weather")).toEqual({ isNewsQuery: false, topic: null });
  });
});
