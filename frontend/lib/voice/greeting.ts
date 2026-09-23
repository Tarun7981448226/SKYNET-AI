export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

// Morning 5-11:59, afternoon 12-16:59, evening 17-20:59, night 21:00-4:59 —
// used for both the arrival greeting and the sign-out farewell so they stay
// consistent with each other and with the clock, not a fixed "Good day".
export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const GREETING_WORD: Record<"morning" | "afternoon" | "evening", string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

// The arrival greeting always addresses him as "Mr. Tarun" — and never
// says "Good night" — that phrase is reserved for an actual end-of-session
// farewell (see below), not just "it happens to be late." Night hours fold
// into "evening" here so opening the app at 11pm doesn't sound like SKYNET
// is already saying goodbye.
export function timeGreeting(date: Date = new Date()): string {
  const timeOfDay = getTimeOfDay(date);
  const word = timeOfDay === "night" ? GREETING_WORD.evening : GREETING_WORD[timeOfDay];
  return `${word}, Mr. Tarun.`;
}

// End-of-session farewell — spoken only when Tarun actually signals he's
// done (e.g. "sign out" / "ending the session"), never automatically from
// the clock. Ordinary conversation (weather, news, Q&A) still stays casual
// with no name at all, per his request that SKYNET talk like a friend day
// to day — only these two ceremonial moments (the arrival greeting and the
// night farewell) use the formal address.
export function farewell(date: Date = new Date()): string {
  return getTimeOfDay(date) === "night" ? "Good night, Mr. Tarun." : "Goodbye, Tarun.";
}
