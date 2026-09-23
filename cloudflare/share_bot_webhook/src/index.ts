/**
 * SKYNET share_bot webhook (Mark IV serverless).
 *
 * Telegram POSTs each incoming message here instead of the bot long-polling
 * getUpdates(). This Worker only does two things: check the message is
 * from the owner chat, and insert its text/photo file_id into the
 * share_bot_inbox table in Neon. It deliberately does NOT run OCR or any
 * parsing — Cloudflare's Workers runtime can't run Tesseract, and keeping
 * this handler tiny means it responds to Telegram fast. The Python side
 * (backend/app/sources/share_bot.py, run by the hourly GitHub Actions
 * pipeline) drains this table, does OCR, and turns each row into a
 * RawPost through the normal pipeline.
 */

import { neon } from "@neondatabase/serverless";

export interface Env {
  DATABASE_URL: string;
  TELEGRAM_OWNER_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

interface TelegramPhotoSize {
  file_id: string;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("SKYNET share_bot webhook is alive.", { status: 200 });
    }

    // Telegram sends this header on every webhook request when a secret
    // token was set via setWebhook — reject anything that doesn't match so
    // only real Telegram traffic can write into the inbox table.
    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;
    if (!message) {
      return new Response("OK", { status: 200 }); // other update types (edits, etc.) — nothing to do
    }

    if (String(message.chat.id) !== env.TELEGRAM_OWNER_CHAT_ID) {
      // Defense in depth — same check the Python side repeats.
      return new Response("OK", { status: 200 });
    }

    const text = message.text ?? message.caption ?? null;
    const photoFileId = message.photo?.length ? message.photo[message.photo.length - 1].file_id : null;

    if (!text && !photoFileId) {
      return new Response("OK", { status: 200 });
    }

    const sql = neon(env.DATABASE_URL);
    await sql`
      INSERT INTO share_bot_inbox (telegram_message_id, chat_id, text, photo_file_id, received_at, processed)
      VALUES (${message.message_id}, ${message.chat.id}, ${text}, ${photoFileId}, now(), false)
      ON CONFLICT (telegram_message_id) DO NOTHING
    `;

    return new Response("OK", { status: 200 });
  },
};
