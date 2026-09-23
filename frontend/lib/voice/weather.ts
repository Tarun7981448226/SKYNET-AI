"use client";

// Live weather via Open-Meteo — free, no API key required, so no secret to
// manage for a voice-demo feature. Two calls: geocode a place name to
// coordinates (skipped if no place was named, using the browser's own
// geolocation instead), then fetch current conditions for those
// coordinates.

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "clear skies",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorms",
  96: "thunderstorms with hail",
  99: "thunderstorms with heavy hail",
};

function describeCode(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? "changing conditions";
}

interface GeocodeResult {
  lat: number;
  lon: number;
  name: string;
}

async function geocode(place: string): Promise<GeocodeResult | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return null;
  return { lat: result.latitude, lon: result.longitude, name: result.name as string };
}

function getCurrentPosition(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 },
    );
  });
}

export async function getWeather(place: string | null): Promise<string> {
  let lat: number;
  let lon: number;
  let locationName: string;

  if (place) {
    const geo = await geocode(place);
    if (!geo) return `I couldn't find a place called ${place}.`;
    ({ lat, lon, name: locationName } = geo);
  } else {
    const pos = await getCurrentPosition();
    if (!pos) {
      return 'I need location access to tell you the local weather — try naming a city instead, like "what\'s the weather in Chicago."';
    }
    lat = pos.lat;
    lon = pos.lon;
    locationName = "your location";
  }

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
  );
  if (!res.ok) return "I couldn't reach the weather service right now.";
  const data = await res.json();
  const temp = Math.round(data.current?.temperature_2m);
  const description = describeCode(data.current?.weather_code);
  return `It's ${temp} degrees and ${description} in ${locationName} right now.`;
}
