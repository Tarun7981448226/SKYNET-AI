"use client";

export async function askQuestion(question: string): Promise<string> {
  const res = await fetch("/api/assistant/ask", {
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
