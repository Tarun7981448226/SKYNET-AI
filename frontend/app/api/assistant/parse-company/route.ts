import { NextRequest, NextResponse } from "next/server";

// Backs the voice "tailor the resume for <company>" / "ready the resume for
// <company> and send it to my telegram" commands (lib/voice/companyResume.ts).
// Extracting the company name with hand-rolled regex kept breaking on real
// speech-to-text noise — a one-word company split into two ("Robinhood"
// heard as "Robin Hood"), a misheard filler word left stuck to the company
// ("ready TO resume for Skyworks" instead of "ready THE resume", leaving
// "to skyworks") — each fix just moved the fragility somewhere else. Gemini
// (same model/key the Python pipeline already uses by default, see
// CLAUDE.md) actually understands the sentence instead of pattern-matching
// it, so it's asked to name the company directly; the caller still keeps a
// local regex fallback for when this call fails outright (no key, network
// down), not as the primary path.
const GEMINI_MODEL = "gemini-flash-lite-latest";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    company: {
      type: ["string", "null"],
      description:
        "The company name the speaker named, normalized to how it's actually spelled/written (e.g. 'Robin Hood' spoken about a fintech company should become 'Robinhood'), with no filler words. Null if no company is named.",
    },
  },
  required: ["company"],
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json({ error: "No transcript given" }, { status: 400 });
  }

  const prompt =
    "A voice assistant heard this command, transcribed by imperfect speech-to-text: \"" +
    transcript +
    '". The command is meant to be something like "tailor/ready/generate the resume for <company>", ' +
    'optionally followed by "and send it to my telegram" or "...linkedin" (both mean deliver via Telegram — ' +
    "LinkedIn is never an actual delivery channel here, just a common mishearing). Identify ONLY the company " +
    "name being referred to, correcting obvious speech-to-text artifacts (a one-word company name split into " +
    "two words, a stray filler word stuck to it, minor misspellings of well-known company names). Ignore every " +
    "instruction word (tailor, ready, resume, generate, prepare, send, telegram, linkedin, channel, please, " +
    "now). If you can't confidently identify a company name at all, return null — never invent one.";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 60,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "Couldn't reach the AI model" }, { status: 502 });
    }
    const data = await res.json();
    const raw: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return NextResponse.json({ company: null });
    }
    const parsed = JSON.parse(raw) as { company: string | null };
    const company = typeof parsed.company === "string" && parsed.company.trim() ? parsed.company.trim() : null;
    return NextResponse.json({ company });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the AI model" }, { status: 502 });
  }
}
