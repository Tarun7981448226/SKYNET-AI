import { neon } from "@neondatabase/serverless";

/**
 * Thin wrapper around the same Postgres (Neon) the Python pipeline writes
 * to. Raw SQL, not an ORM — Alembic on the Python side stays the single
 * schema source of truth (backend/alembic/versions/); this file only reads
 * and writes rows.
 *
 * `@neondatabase/serverless` is already a proven dependency in this repo
 * (cloudflare/share_bot_webhook) — an HTTP-based driver with no
 * connection-pool lifecycle to manage, which fits Vercel's stateless
 * serverless functions.
 */
// Lazy singleton — importing this module shouldn't require DATABASE_URL to
// be set (keeps unrelated unit tests, like the briefing text builder, free
// of a real DB dependency). Only actually connecting requires it.
let client: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = neon(url);
  }
  return client;
}
