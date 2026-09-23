import { NextRequest, NextResponse } from "next/server";

import { sendPushToAll } from "@/lib/push/send";

// Called by the Python backend (backend/app/push_notify.py), not a logged-in
// browser session — GitHub Actions has no session cookie, so this is gated
// by a shared secret header instead of requireSession. No existing
// precedent for this direction in the codebase (GITHUB_DISPATCH_TOKEN is
// the frontend calling *out* to GitHub, not the reverse).
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-push-secret");
  if (!secret || secret !== process.env.PUSH_NOTIFY_SECRET) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { title?: string; body?: string; url?: string } | null;
  if (!body?.title || !body?.body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await sendPushToAll({ title: body.title, body: body.body, url: body.url || "/dashboard" });
  return NextResponse.json(result);
}
