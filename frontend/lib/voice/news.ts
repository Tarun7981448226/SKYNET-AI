"use client";

export async function getNews(topic: string | null): Promise<string> {
  const url = topic ? `/api/assistant/news?topic=${encodeURIComponent(topic)}` : "/api/assistant/news";
  const res = await fetch(url);
  if (!res.ok) return "I couldn't reach the news service right now.";
  const data = await res.json();
  const headlines: string[] = data.headlines ?? [];
  if (headlines.length === 0) {
    return topic ? `I couldn't find any news about ${topic}.` : "I couldn't find any news right now.";
  }
  const top = headlines.slice(0, 3);
  const intro = topic ? `Here's the latest on ${topic}:` : "Here's the latest news:";
  return `${intro} ${top.join(". ")}.`;
}
