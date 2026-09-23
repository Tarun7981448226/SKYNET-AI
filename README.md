# SKYNET

**Status: Marks I–VI complete** — ingestion, parsing, fit scoring,
resume tailoring, serverless scheduling, passkey auth, a voice assistant,
a live dashboard, a PWA, and push notifications are all built and
live-verified. The only open item is real WhatsApp delivery, blocked on a
Meta account verification step outside this project's control (Telegram
stands in for now). See the [Status](#status) section below for detail.

Silicon Valley Job Monitoring AI — a 24/7 agent that ingests job posts,
parses JDs, scores fit, tailors ATS-safe resumes from a master profile,
logs to Google Sheets, and shows results on a morning dashboard.

See [PRD.md](PRD.md) for the full architecture and roadmap.
[DEPLOYMENT_TROUBLESHOOTING.md](DEPLOYMENT_TROUBLESHOOTING.md) is a real
log of the significant bugs hit across this project — from the Mark IV
serverless pipeline through the Mark VI PWA/push work — and exactly how
each was root-caused and fixed. Worth checking before re-diagnosing
something that might already be documented there.

## Quickstart
```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real credentials
pytest
docker compose up      # api + postgres (postgres on host port 5433)

cd backend && alembic upgrade head
python -m backend.cli ingest --source greenhouse
python -m backend.cli parse --pending
python -m backend.cli tailor --pending

cd frontend && npm run dev
```

Fill in `data/resume_aiml.md` and `data/resume_swe.md` (gitignored) with
your real per-domain resume data — see the schema comment at the top of
`data/resume.example.md`. Tailoring picks whichever file matches a job's
parsed `domain`; a job classified into a domain with no file yet gets
flagged in the Sheet instead of tailored. Google Sheets logging needs a
service-account key under `credentials/` and `GOOGLE_SHEETS_ID` in `.env`.

## Production deploy — serverless, no VM
`docker compose` above is for local dev only. In production this runs on:
- **GitHub Actions** (`.github/workflows/`) — scheduled workflows instead
  of a persistent daemon
- **Neon** — hosted Postgres instead of self-managed
- **Cloudflare Workers** (`cloudflare/share_bot_webhook/`) — a webhook
  instead of a long-polling Telegram bot for share-intake
- **Google Drive** — generated resumes upload here since Actions runners
  have no persistent disk

No VM, no card required anywhere in this path. (Earlier plans to deploy to
a VM on Oracle Cloud, then GCP, then Azure for Students each hit real
signup/billing friction — see `DEPLOYMENT_TROUBLESHOOTING.md` for what
happened.)

## Talk to SKYNET by voice (macOS Shortcuts)
The dashboard (`frontend/`) has a voice assistant built in — an orb that
greets you with a real briefing, answers questions, and takes commands
(see `frontend/lib/voice/`). To trigger it hands-free with "Hey Siri,
SKYNET" instead of opening the tab yourself:

1. Open the **Shortcuts** app (Spotlight → "Shortcuts").
2. Click **+** to create a new shortcut.
3. Add the **"Open URLs"** action, set it to your dashboard's URL —
   `http://localhost:3000/dashboard` for local dev, or
   `https://skynet-ten-omega.vercel.app/dashboard` for the real deployment.
4. Open the shortcut's settings (⋯) → toggle **"Use with Siri"** → record
   a phrase, e.g. "SKYNET."
5. Say "Hey Siri, SKYNET" any time — it opens the dashboard, which then
   greets you with the morning briefing automatically.

This only opens the page — the orb's greeting/listening/answering all
happens in the page itself once it loads, same as opening the URL by hand.

## Meet EVE on the public landing page
`https://skynet-ten-omega.vercel.app` (no login needed) is EVE herself —
not a marketing page with a chatbot bolted on, she *is* the page. She's
rendered from a real 3D model (exported from an actual Blender file, not a
flat drawing), flies in, introduces herself, and asks your name. Say yes to
"would you like to know more about me?" and she opens a rotating card
picker: a full narrated presentation of what SKYNET does, who built her,
what she actually does day-to-day, or all three back to back. Talk to her
by voice or just tap the cards — either way works.

## Paste a job link → get the tailored resume sent to your phone
The dashboard also has an on-demand path that doesn't wait for the hourly
pipeline: paste any job posting URL into the "Paste a job link" box, and
SKYNET fetches the page, scores it, tailors your resume, and sends the PDF
straight to your phone — usually a couple of minutes, longer if the LLM
provider is having a slow moment (it retries and falls back gracefully
rather than failing the request).

> **Delivery is currently Telegram, not WhatsApp.** The design below (and
> the code in `backend/app/whatsapp.py`) is the real, intended path via
> Meta's official WhatsApp Cloud API — but Tarun's Meta account hit a
> device-trust security hold mid-signup, so `backend/app/telegram_delivery.py`
> stands in for now (his already-configured Telegram bot, zero new setup).
> Once the WhatsApp setup below is actually done, reverting is a one-line
> import swap in `backend/app/cli.py` — see that file's docstring.

How it works: the dashboard inserts a `link_resume_requests` row and
immediately triggers `.github/workflows/link_resume.yml` via GitHub's
`workflow_dispatch` API (instead of waiting for `pipeline.yml`'s hourly
cron), which runs `python -m backend.cli link-resume` and updates that row
when it's done — the dashboard polls it and shows the result.

Two things need a one-time setup before the real WhatsApp path works — I
can't do either signup on your behalf:

**1. A GitHub token so the dashboard can trigger the workflow.** Create a
fine-grained personal access token (GitHub → Settings → Developer settings
→ Fine-grained tokens) scoped to this repo only, with **Actions:
read and write** permission. Add to Vercel's env vars:
```
GITHUB_DISPATCH_TOKEN=<the token>
GITHUB_REPOSITORY=<your-username>/SKYNET
```

**2. A WhatsApp Cloud API app (Meta's official, compliant API — not an
unofficial personal-account automation library, which risks the account
getting banned).**
1. Go to [developers.facebook.com](https://developers.facebook.com) →
   create a free app → add the **WhatsApp** product.
2. Meta gives you a free test phone number automatically. Note its
   **Phone number ID** (shown on the WhatsApp → API Setup page).
3. On that same page, generate a **temporary access token** (24h, for
   testing) or set up a permanent one via a System User (for real use).
4. Add your own phone number as a verified recipient (API Setup page →
   "To" field → "Manage phone number list") — Meta test apps can only
   message pre-verified numbers.
5. **Important real constraint, not a bug**: WhatsApp only lets a business
   number message you freely within 24 hours of you last messaging *it*.
   Outside that window, only a pre-approved template message goes through.
   In practice: message the test number "hi" whenever it's been a while,
   to keep the window open before pasting a link.

Add to GitHub Actions Secrets (Settings → Secrets and variables → Actions):
```
WHATSAPP_ACCESS_TOKEN=<the token from step 3>
WHATSAPP_PHONE_NUMBER_ID=<from step 2>
WHATSAPP_RECIPIENT_NUMBER=<your number, e.g. 15551234567 — no + or spaces>
```
(`GOOGLE_DRIVE_FOLDER_ID`, `GEMINI_API_KEY`, `DRIVE_TOKEN_JSON` etc. are
the same secrets `pipeline.yml` already uses — nothing new there.)

## Status
Marks I–IV complete and fully live-verified: ingestion, parsing, fit
scoring, domain-specific resume tailoring, PDF/DOCX rendering, Google
Sheets logging, and serverless 24/7 scheduling (GitHub Actions cron, Drive
uploads, Telegram alerts, share-intake webhook) all confirmed working end
to end on real runs, not just fixtures.

Marks V–VI (login, voice assistant, dashboard, PWA, push notifications)
are also done and **live at `https://skynet-ten-omega.vercel.app`**:
password + WebAuthn passkey login, a 3D holographic voice assistant orb
(weather/news/general Q&A, system commands, a data-driven morning
briefing spoken on load, spoken job stats, reading a job list aloud and
acting on a specific item by voice — "mark the second one applied"), a
real dashboard (stats, filtered job feed, Apply/Reject, View Resume,
paste-a-link on-demand resumes), a real 3D EVE on the public landing page
with a name-and-options conversation flow, installable as a PWA, and web
push notifications the moment a new tailored resume is ready. Still open:
real WhatsApp delivery (Telegram stands in for now — see above), pending
a Meta account verification step outside this project's control. See
[PRD.md](PRD.md) for the full roadmap.

## License
All rights reserved — see [LICENSE](LICENSE). This code is shared
publicly for portfolio/demonstration purposes only; no reuse, copying, or
redistribution is permitted without written permission.
