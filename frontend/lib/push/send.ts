import webpush from "web-push";

import { getSql } from "@/lib/db";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function configureVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID keys not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

// Sends to every stored subscription (single-user app — no per-user
// scoping needed, just every device Tarun has ever clicked the orb on).
// A 404/410 means the browser unsubscribed or the endpoint expired —
// standard web-push cleanup is to drop that row rather than keep retrying
// a dead endpoint forever.
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; removed: number }> {
  configureVapid();
  const sql = getSql();
  const rows = (await sql`select id, endpoint, p256dh, auth from push_subscriptions`) as SubscriptionRow[];

  let sent = 0;
  let removed = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await sql`delete from push_subscriptions where id = ${row.id}`;
          removed += 1;
        }
      }
    }),
  );

  return { sent, removed };
}
