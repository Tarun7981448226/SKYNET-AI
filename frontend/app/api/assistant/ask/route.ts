import { NextRequest, NextResponse } from "next/server";

// Fallback for anything that isn't a recognized command/weather/news query
// — same Gemini model the Python pipeline already uses by default, called
// directly via REST since this is a small one-off call, not worth pulling
// in a full SDK for.
const GEMINI_MODEL = "gemini-flash-lite-latest";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The assistant's general Q&A isn't configured yet." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "No question given." }, { status: 400 });
  }

  const prompt =
    "You are SKYNET, a voice assistant spoken out loud through text-to-speech as part of Tarun's personal " +
    "job-monitoring system (it ingests job postings, scores fit against his resume, tailors resumes, and logs " +
    "results). You're Tarun's own AI, closer to how F.R.I.D.A.Y. talks to Tony Stark than a customer-service " +
    "bot — warm, easygoing, a little witty, like a friend, never stiff or formal. Talk to him casually and, if " +
    "you address him at all, use his first name only — never 'Mr. Tarun' or any formal title, that's reserved " +
    "for one specific moment elsewhere in the app, not ordinary conversation. Answer in ONE short sentence, " +
    'plain conversational text, no markdown, no lists, no preamble like "Great question" — just the answer ' +
    "itself, under 25 words. If asked whether you're human, say plainly that you're an AI assistant. If the " +
    "question genuinely needs more than one sentence, give the single most important sentence only.\n\n" +
    "Question: " +
    question;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // Hard cap, not just a prompt instruction Gemini could ignore —
          // keeps runaway/rambling answers structurally impossible.
          generationConfig: { maxOutputTokens: 60 },
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "The assistant couldn't reach its AI model right now." }, { status: 502 });
    }
    const data = await res.json();
    const answer: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return NextResponse.json({ answer: answer?.trim() || "I don't have an answer for that." });
  } catch {
    return NextResponse.json({ error: "The assistant couldn't reach its AI model right now." }, { status: 502 });
  }
}
