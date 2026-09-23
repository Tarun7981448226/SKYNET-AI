"use client";

// Thin wrapper around the browser's built-in SpeechSynthesis API — no
// backend/API key needed, works entirely client-side. Picks a natural
// male, OS-installed voice (Alex/Daniel on macOS) over Chrome's own
// network-based voices, which tend to sound more robotic and default to
// female (Samantha/Google US English).
const PREFERRED_VOICE_NAMES = ["Alex", "Daniel", "Fred", "Google UK English Male"];

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  // "Built into the system" — an OS-installed voice over any of Chrome's
  // own network/cloud voices, which need an internet round-trip and tend
  // to sound less natural.
  const localEnglish = voices.find((v) => v.lang.startsWith("en") && v.localService);
  if (localEnglish) return localEnglish;
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
}

export function getPreferredVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!isSpeechSupported()) return Promise.resolve(null);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(pickVoice(existing));

  // Some browsers (notably Chrome, on the very first call) load the voice
  // list asynchronously rather than having it ready immediately.
  return new Promise((resolve) => {
    const handle = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handle);
      resolve(pickVoice(window.speechSynthesis.getVoices()));
    };
    window.speechSynthesis.addEventListener("voiceschanged", handle);
    setTimeout(() => resolve(pickVoice(window.speechSynthesis.getVoices())), 1000);
  });
}

// Browsers have no SSML/phonetic-hint support for SpeechSynthesisUtterance
// — the only lever available is respelling a word so the TTS engine's
// default English pronunciation rules land closer to correct. Applied
// automatically here (not by every caller) so callers only ever handle
// the real, correctly-spelled text — this must stay a same-word-count
// substitution, since onWordBoundary indexes by word position and the
// caller's displayed text keeps the real spelling.
// Best-effort guess, not verified by ear (no audio output in this dev
// environment) — if a name still sounds wrong, adjust the respelling here.
const PHONETIC_RESPELLINGS: Record<string, string> = {
  tarun: "Taroon",
};

function applyPhoneticRespellings(text: string): string {
  return text.replace(/\b[a-zA-Z]+\b/g, (word) => PHONETIC_RESPELLINGS[word.toLowerCase()] ?? word);
}

export interface SpeakOptions {
  // Fires once per spoken word, in order — used to drive live captions.
  onWordBoundary?: (wordIndex: number) => void;
}

export async function speak(text: string, opts?: SpeakOptions): Promise<void> {
  if (!isSpeechSupported()) {
    throw new Error("Speech synthesis not supported in this browser");
  }
  window.speechSynthesis.cancel();
  const voice = await getPreferredVoice();
  // Cancel again right before enqueueing, not just before the await above.
  // getPreferredVoice() is async (can take up to ~1s on a browser's first
  // call), so two speak() calls can race: an earlier call's cancel() can
  // fire while a later call is still awaiting the voice lookup — too early
  // to catch the later call's utterance once it's actually enqueued below.
  // Without this second cancel, both calls' utterances end up queued back
  // to back and both get spoken (this is what caused React StrictMode's
  // dev-mode double-invoke of an effect calling speak() to read the same
  // line twice — the phantom mount's cancel from cleanup landed before its
  // own speak() had enqueued anything).
  window.speechSynthesis.cancel();
  // Chrome has a well-known speechSynthesis bug: once anything calls
  // pause() (cancelSpeech() below does, e.g. from a "mute"/Skip action
  // anywhere on the page), the engine's internal paused flag can outlive
  // cancel() — a later speak() call then enqueues its utterance silently
  // and it never actually plays, no error, nothing. Live-verified: the
  // bio and capabilities cards were reachable right after a prior
  // speakText was interrupted (e.g. tapping a carousel card while she was
  // still mid-sentence) and went completely silent. cancelSpeech() already
  // guards against this for itself (see its own comment below) — this is
  // the same guard on the normal speak path, so it can never happen here
  // regardless of what ran before it.
  window.speechSynthesis.resume();
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(applyPhoneticRespellings(text));
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    let wordIndex = 0;
    utterance.onboundary = (event) => {
      if (event.name === "word" || event.name === undefined) {
        opts?.onWordBoundary?.(wordIndex);
        wordIndex += 1;
      }
    };
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error));
    window.speechSynthesis.speak(utterance);
  });
}

export function cancelSpeech(): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  // A single cancel() call can silently fail to actually stop an
  // utterance that's already partway through playing — reported live:
  // clicking the orb to mute, or saying "mute", was received and
  // handled (state changed correctly) but the longer answer already
  // speaking kept going anyway. pause() forcibly halts the current
  // utterance's audio right away; cancel() again then clears the
  // (now paused) queue so nothing resumes; resume() guarantees the
  // engine isn't left paused in a way that would silently swallow the
  // *next* speak() call.
  synth.cancel();
  synth.pause();
  synth.cancel();
  synth.resume();
}
