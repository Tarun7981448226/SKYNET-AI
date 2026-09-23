import type { LinkResumeRequestStatus } from "@/lib/dashboard/types";

// "Score the link I just copied" — the hands-free version of
// LinkResumePanel.tsx's paste-a-link box. Speech recognition transcribes
// URLs badly, so this reads the URL from the clipboard instead of asking
// the visitor to say it, and posts to the exact same
// POST /api/dashboard/link-resume + GET /api/dashboard/link-resume/[id]
// pair the manual UI already uses.
export function isScoreClipboardCommand(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return (
    /\bscore\b.*\b(clipboard|link|job)\b/.test(normalized) ||
    /\btailor\b.*\b(clipboard|link|job)\b/.test(normalized)
  );
}

const URL_PATTERN = /https?:\/\/\S+/i;

export function extractUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  // Trailing punctuation a sentence or clipboard copy might carry along
  // ("...check this out: https://x.com/y.") isn't part of the URL itself.
  return match ? match[0].replace(/[).,!?]+$/, "") : null;
}

export type SubmitLinkResult = { requestId: number } | { error: string };

export async function submitLink(url: string): Promise<SubmitLinkResult> {
  try {
    const res = await fetch("/api/dashboard/link-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: data.error ?? "Couldn't start processing that link." };
    }
    return { requestId: data.requestId };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

export async function pollLinkResumeOnce(requestId: number): Promise<LinkResumeRequestStatus | null> {
  const res = await fetch(`/api/dashboard/link-resume/${requestId}`);
  if (!res.ok) return null;
  return (await res.json()) as LinkResumeRequestStatus;
}

// Spoken version of LinkResumePanel.tsx's own done/failed copy — "Sent to
// Telegram" for now, same temporary-Telegram-standing-in-for-WhatsApp note
// as that component (see its header comment).
export function describeLinkResumeResult(status: LinkResumeRequestStatus): string {
  if (status.status === "failed") {
    return status.error ?? "That request failed.";
  }
  const deliveryPart =
    status.whatsapp_status === "sent"
      ? "Sent to Telegram."
      : status.whatsapp_status
        ? `Telegram: ${status.whatsapp_status}.`
        : "";
  return `Fit score ${status.score}. ${deliveryPart}`.trim();
}
