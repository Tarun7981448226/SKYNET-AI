import { NextRequest, NextResponse } from "next/server";

// Google News' public RSS feed — free, no API key, but browsers can't fetch
// it directly (no permissive CORS headers), so this route proxies it
// server-side where CORS doesn't apply, then hands back parsed headlines.
function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get("topic");
  const feedUrl = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`;

  let xml: string;
  try {
    const res = await fetch(feedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      return NextResponse.json({ headlines: [] }, { status: 502 });
    }
    xml = await res.text();
  } catch {
    return NextResponse.json({ headlines: [] }, { status: 502 });
  }

  // Regex, not a real XML parser — Node has no built-in one and Google
  // News' feed format is regular enough for this to be reliable in
  // practice; it just isn't guaranteed against a genuinely malformed feed.
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const headlines = itemBlocks
    .map((block) => {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      return titleMatch ? decodeXmlEntities(titleMatch[1]) : null;
    })
    .filter((title): title is string => Boolean(title))
    .slice(0, 5);

  return NextResponse.json({ headlines });
}
