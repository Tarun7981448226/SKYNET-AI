export type VoiceCommand = "close" | "sign-out" | "mute" | "show-dashboard" | "hide-dashboard" | "show-login";

const COMMAND_PHRASES: Record<VoiceCommand, string[]> = {
  close: ["close", "close tab", "close the tab"],
  // Public-landing-page-only in practice (the authenticated dashboard has
  // no reason to trigger this) — takes an anonymous visitor to the real
  // sign-in page instead of answering anything about what's behind it.
  "show-login": [
    "sign in",
    "log in",
    "log me in",
    "login",
    "signin",
    "i need access",
    "need access",
    "give me access",
    "show me the sign in",
    "show the sign in",
    "sign in tab",
    "sign in page",
    "take me to sign in",
    "let me sign in",
    "open the sign in page",
  ],
  "sign-out": [
    "sign out",
    "signout",
    "log out",
    "logout",
    "ending the session",
    "end the session",
    "end session",
    "i'm done for today",
    "im done for today",
    "i'm done for the day",
    "im done for the day",
    "that's it for today",
    "thats it for today",
  ],
  mute: ["mute", "stop", "pause", "be quiet", "quiet"],
  // Longer/more specific than the bare "close" phrase above, so
  // longest-match-wins correctly picks this over close-the-tab for
  // anything mentioning "dashboard".
  "show-dashboard": ["show dashboard", "show the dashboard", "open dashboard", "open the dashboard"],
  "hide-dashboard": ["hide dashboard", "hide the dashboard", "close dashboard", "close the dashboard"],
};

// Simple substring keyword matching — good enough for a small fixed
// command set, checked longest-phrase-first within each command so "close
// the tab" doesn't get shadowed by a shorter phrase from another command.
export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const normalized = transcript.trim().toLowerCase();
  if (!normalized) return null;

  let best: { command: VoiceCommand; phraseLength: number } | null = null;
  for (const [command, phrases] of Object.entries(COMMAND_PHRASES) as [VoiceCommand, string[]][]) {
    for (const phrase of phrases) {
      if (normalized.includes(phrase) && (!best || phrase.length > best.phraseLength)) {
        best = { command, phraseLength: phrase.length };
      }
    }
  }
  return best?.command ?? null;
}

export interface WeatherQuery {
  isWeatherQuery: boolean;
  place: string | null;
}

// "weather" is the trigger keyword — matches "how's the weather",
// "what's the weather", "what's the weather in Tokyo right now", etc. A
// trailing "in <place>" names a specific place; otherwise the caller falls
// back to the device's own location.
export function parseWeatherQuery(transcript: string): WeatherQuery {
  const normalized = transcript.trim().toLowerCase();
  if (!/\bweather\b/.test(normalized)) {
    return { isWeatherQuery: false, place: null };
  }
  const match = normalized.match(/\bin\s+([a-z\s]+?)(?:\s+(?:right now|today|currently))?[.?!]?$/);
  const place = match ? match[1].trim() : null;
  return { isWeatherQuery: true, place: place || null };
}

export interface NewsQuery {
  isNewsQuery: boolean;
  topic: string | null;
}

// "news" is the trigger keyword. A trailing "about <topic>", "on <topic>",
// or "in <place>" (e.g. "what's the news in India") narrows it; otherwise
// the caller falls back to top general headlines.
export function parseNewsQuery(transcript: string): NewsQuery {
  const normalized = transcript.trim().toLowerCase();
  if (!/\bnews\b/.test(normalized)) {
    return { isNewsQuery: false, topic: null };
  }
  const match = normalized.match(/\b(?:about|on|in)\s+([a-z\s]+?)[.?!]?$/);
  const topic = match ? match[1].trim() : null;
  return { isNewsQuery: true, topic: topic || null };
}
