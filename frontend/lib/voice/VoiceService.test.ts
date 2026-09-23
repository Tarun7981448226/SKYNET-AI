import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPreferredVoice, speak } from "./VoiceService";

class FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

describe("VoiceService", () => {
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let voices: Array<{ name: string; lang: string; localService: boolean }>;

  beforeEach(() => {
    voices = [
      { name: "Robotic Voice", lang: "en-US", localService: false },
      { name: "Samantha", lang: "en-US", localService: true },
    ];
    speakMock = vi.fn((utterance: FakeUtterance) => utterance.onend?.());
    cancelMock = vi.fn();

    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      speak: speakMock,
      cancel: cancelMock,
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  });

  it("prefers a known natural-sounding voice over the first available one", async () => {
    const voice = await getPreferredVoice();
    expect(voice?.name).toBe("Samantha");
  });

  it("speaks the given text using the preferred voice and resolves on end", async () => {
    await speak("Hello there.");

    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe("Hello there.");
    expect(utterance.voice?.name).toBe("Samantha");
  });

  it("respells known tricky names phonetically for the TTS engine only", async () => {
    await speak("Welcome, Tarun.");

    const utterance = speakMock.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe("Welcome, Taroon.");
  });

  it("cancels any in-flight speech before starting new speech", async () => {
    await speak("first");
    await speak("second");
    expect(cancelMock).toHaveBeenCalled();
  });
});
