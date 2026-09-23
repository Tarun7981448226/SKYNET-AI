import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";

interface SubscriptionPayload {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(request: NextRequest) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SubscriptionPayload | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const sql = getSql();
  // Upsert: a browser that already subscribed (e.g. reinstalled the PWA,
  // or the orb was clicked again) just refreshes the stored keys instead
  // of erroring on the unique endpoint constraint.
  await sql`
    insert into push_subscriptions (endpoint, p256dh, auth)
    values (${endpoint}, ${p256dh}, ${auth})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
  `;

  return NextResponse.json({ ok: true });
}
