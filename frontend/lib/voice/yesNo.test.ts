import { describe, expect, it } from "vitest";

import { parseYesNo } from "./yesNo";

describe("parseYesNo", () => {
  it.each(["yes", "yeah please", "sure, go ahead", "okay", "of course"])("reads %j as yes", (t) => {
    expect(parseYesNo(t)).toBe("yes");
  });

  it.each(["no", "nope", "nah don't", "cancel that", "never mind"])("reads %j as no", (t) => {
    expect(parseYesNo(t)).toBe("no");
  });

  it("returns null for an unrelated utterance", () => {
    expect(parseYesNo("what's the weather")).toBeNull();
  });
});
