import { NextRequest, NextResponse } from "next/server";

import { getSql } from "@/lib/db";

// Public — no requireSession. This is the landing page's EVE, answerable
// by anyone on the internet with no login, so it deliberately knows far
// less than the authenticated dashboard's assistant (lib/voice/qa.ts):
// no job data, no internal architecture, no "how was this built." A tight,
// separate system prompt plus per-IP rate limiting (public_ask_rate_limit,
// see backend/app/models/rate_limit.py) keep this endpoint from becoming a
// free-tier-Gemini-quota drain or a general-purpose chatbot for strangers.
const GEMINI_MODEL = "gemini-flash-lite-latest";
const RATE_LIMIT_MAX = 8; // requests
const RATE_LIMIT_WINDOW_LABEL = "60 seconds"; // must match the interval literal in the SQL below

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const sql = getSql();
  // Single atomic upsert (not read-then-write) so concurrent requests from
  // the same IP can't race past the cap: a fixed 60s window that resets
  // itself once expired, otherwise increments and returns the new count.
  const rows = (await sql`
    insert into public_ask_rate_limit (ip, window_start, count)
    values (${ip}, now(), 1)
    on conflict (ip) do update set
      count = case
        when public_ask_rate_limit.window_start < now() - interval '60 seconds'
        then 1
        else public_ask_rate_limit.count + 1
      end,
      window_start = case
        when public_ask_rate_limit.window_start < now() - interval '60 seconds'
        then now()
        else public_ask_rate_limit.window_start
      end
    returning count
  `) as { count: number }[];
  return Number(rows[0]?.count ?? 0) <= RATE_LIMIT_MAX;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The assistant isn't configured yet." }, { status: 500 });
  }

  const ip = getClientIp(request);
  let allowed: boolean;
  try {
    allowed = await checkRateLimit(ip);
  } catch {
    // If the rate-limit table itself is unreachable, fail closed on the
    // Gemini call below rather than open — but don't let a DB hiccup take
    // down the landing page entirely.
    allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: `Too many questions — try again in under a minute (limit: ${RATE_LIMIT_MAX} per ${RATE_LIMIT_WINDOW_LABEL}).` },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "No question given." }, { status: 400 });
  }

  const prompt =
    "You are SKYNET, a voice character greeting visitors on the public landing page of a personal AI job-" +
    "monitoring project built by Tarun. The visitor is NOT signed in. Never reveal private data, job listings, " +
    "internal architecture, tech stack, source code, or implementation details — if asked about any of that, " +
    "say plainly and briefly that those details are private and the person should sign in if they have access; " +
    "don't elaborate further or guess. For harmless small talk or general-knowledge questions unrelated to this " +
    "project, answer normally and briefly. Reply in the same language the question below is written in, even if " +
    "these instructions are in English. Answer in ONE short sentence, plain conversational text, no markdown, " +
    'no lists, no preamble like "Great question" — just the answer itself, under 25 words.\n\nQuestion: ' +
    question;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
