import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWeather } from "./weather";

describe("getWeather", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("geocodes a named place and reports its current conditions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("geocoding-api")) {
        return {
          ok: true,
          json: async () => ({ results: [{ latitude: 35.68, longitude: 139.69, name: "Tokyo" }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ current: { temperature_2m: 68.4, weather_code: 2 } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getWeather("Tokyo");

    expect(result).toBe("It's 68 degrees and partly cloudy in Tokyo right now.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports when a named place can't be found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) })),
    );

    const result = await getWeather("Nowhereville");

    expect(result).toBe("I couldn't find a place called Nowhereville.");
  });

  describe("without a named place", () => {
    let originalGeolocation: Geolocation | undefined;

    beforeEach(() => {
      originalGeolocation = navigator.geolocation;
    });

    afterEach(() => {
      Object.defineProperty(navigator, "geolocation", {
        value: originalGeolocation,
        configurable: true,
      });
    });

    it("falls back to the device's own location when geolocation succeeds", async () => {
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: (success: PositionCallback) => {
            success({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition);
          },
        },
        configurable: true,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ current: { temperature_2m: 55.0, weather_code: 61 } }),
        })),
      );

      const result = await getWeather(null);

      expect(result).toBe("It's 55 degrees and light rain in your location right now.");
    });

    it("asks the user to name a city when geolocation is unavailable", async () => {
      Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });

      const result = await getWeather(null);

      expect(result).toMatch(/naming a city/i);
    });
  });
});
