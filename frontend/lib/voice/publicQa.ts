"use client";

// Calls the separate, rate-limited, restricted-knowledge endpoint — never
// /api/assistant/ask, which is the authenticated dashboard's much more
// open Q&A agent. See app/api/public/ask/route.ts for why these are split.
export async function askPublicQuestion(question: string): Promise<string> {
  const res = await fetch("/api/public/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return data.error ?? "I couldn't get an answer to that right now.";
  }
  return data.answer ?? "I don't have an answer for that.";
}
