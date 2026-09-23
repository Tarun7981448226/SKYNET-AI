// Shared yes/no detection for any voice flow that asks a follow-up
// question and needs to read the next transcript as an answer to it
// (EvePublic.tsx's "would you like to know more about me?", SiriOrb.tsx's
// decision-confirmation step). Only recognizes an explicit "no" — anything
// that isn't a clear yes or a clear no is treated as neither, so the caller
// can decide whether to fall through to normal dispatch instead of forcing
// a binary answer out of an unrelated utterance.
const YES_WORDS = /\b(yes|yeah|yep|sure|okay|ok|please|definitely|of course)\b/i;
const NO_WORDS = /\b(no|nope|nah|don't|do not|cancel|never mind|nevermind)\b/i;

export function parseYesNo(transcript: string): "yes" | "no" | null {
  if (YES_WORDS.test(transcript)) return "yes";
  if (NO_WORDS.test(transcript)) return "no";
  return null;
}
