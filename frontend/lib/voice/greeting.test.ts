import { describe, expect, it } from "vitest";

import { getTimeOfDay, timeGreeting, farewell } from "./greeting";

function at(hour: number): Date {
  return new Date(2026, 0, 1, hour, 0, 0);
}

describe("getTimeOfDay", () => {
  it("buckets the day into morning/afternoon/evening/night", () => {
    expect(getTimeOfDay(at(6))).toBe("morning");
    expect(getTimeOfDay(at(11))).toBe("morning");
    expect(getTimeOfDay(at(12))).toBe("afternoon");
    expect(getTimeOfDay(at(16))).toBe("afternoon");
    expect(getTimeOfDay(at(17))).toBe("evening");
    expect(getTimeOfDay(at(20))).toBe("evening");
    expect(getTimeOfDay(at(21))).toBe("night");
    expect(getTimeOfDay(at(2))).toBe("night");
  });
});

describe("timeGreeting", () => {
  it("always addresses him as Mr. Tarun", () => {
    expect(timeGreeting(at(8))).toBe("Good morning, Mr. Tarun.");
    expect(timeGreeting(at(14))).toBe("Good afternoon, Mr. Tarun.");
    expect(timeGreeting(at(18))).toBe("Good evening, Mr. Tarun.");
  });

  it("never says Good night on arrival — folds night hours into evening", () => {
    expect(timeGreeting(at(23))).toBe("Good evening, Mr. Tarun.");
    expect(timeGreeting(at(2))).toBe("Good evening, Mr. Tarun.");
  });
});

describe("farewell", () => {
  it("is a casual goodbye in the daytime", () => {
    expect(farewell(at(10))).toBe("Goodbye, Tarun.");
  });

  it("is Good night, Mr. Tarun at night", () => {
    expect(farewell(at(23))).toBe("Good night, Mr. Tarun.");
  });
});
