# share_bot webhook

Receives Telegram messages Tarun forwards for share-intake (job links,
screenshots, captions) and stores them in Neon's `share_bot_inbox` table.
Replaces the old long-polling bot from the VM design — no server needs to
stay running, Cloudflare only invokes this on an actual incoming message.

## One-time setup

1. **Install deps**: `cd cloudflare/share_bot_webhook && npm install`
2. **Log in to Cloudflare** (free account, no card required for the Workers free tier): `npx wrangler login`
3. **Set secrets**:
   ```bash
   npx wrangler secret put DATABASE_URL            # same Neon connection string as .env
   npx wrangler secret put TELEGRAM_OWNER_CHAT_ID   # same value as .env
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # make up a random string, e.g. `openssl rand -hex 20`
   ```
4. **Deploy**: `npm run deploy` — prints the Worker's URL (`https://skynet-share-bot-webhook.<your-subdomain>.workers.dev`).
5. **Point Telegram at it** (replace `<BOT_TOKEN>`, `<WORKER_URL>`, and `<WEBHOOK_SECRET>` — the last one must match what you set in step 3):
   ```bash
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "<WORKER_URL>", "secret_token": "<WEBHOOK_SECRET>"}'
   ```
   A successful response looks like `{"ok":true,"result":true,...}`.

## Verifying it works
Forward a link or screenshot to the SKYNET bot on Telegram, then check
Neon's SQL editor:
```sql
select * from share_bot_inbox order by received_at desc limit 5;
```
Your message should show up with `processed = false`. It flips to `true`
the next time the hourly GitHub Actions pipeline runs `ingest --source
share_bot` (backend/app/sources/share_bot.py), which also does the OCR for
any screenshots.

## Local dev
`npm run dev` runs the Worker locally via `wrangler dev` — useful for
testing the webhook logic before deploying, though `setWebhook` would need
to point at a public tunnel (e.g. `wrangler dev --remote` or `cloudflared
tunnel`) to actually receive real Telegram traffic locally.
