# Mistakes & Fixes Log

A real record of the significant bugs hit across this project — from the
Mark IV serverless pipeline through the Mark V Vercel deployment — and how
each was actually root-caused and fixed. Only the non-obvious, worth-
remembering ones are here; this is deliberately not a full changelog. Kept
so the same mistakes aren't repeated, and so anyone hitting the same
symptoms can jump straight to the fix instead of re-diagnosing from
scratch.

## Part 1: Pipeline & Product Bugs (Mark IV–V)

### Three VM hosting attempts failed before the deploy model changed entirely

**What happened:** Mark IV's original design assumed a persistent VM
daemon. Oracle Cloud rejected the account at signup, Google Cloud put a
large card authorization hold, and Azure for Students hit a subscription
region/quota policy wall — three different providers, three different
real blockers, no VM ever actually stood up.

**Fix:** Abandoned the VM model entirely rather than continuing to fight
signup friction. Pivoted to fully serverless: GitHub Actions scheduled
workflows instead of an always-on daemon, Neon for hosted Postgres instead
of self-managed, a Cloudflare Worker instead of a long-polling Telegram
bot. No VM, no card required anywhere in the resulting path, no
SSH-exposed attack surface.

**Lesson:** Verify hosting signup friction *early*, before architecting
around a hosting model — three separate providers hitting real blockers
is a strong signal the constraint is worth designing around, not working
through.

### Google Drive uploads failed under the Sheets service account

**What happened:** `drive.files.create()` was tried first under the same
service account already used for Sheets logging. It failed with
"Service Accounts do not have storage quota" — a hard rule on personal
(non-Workspace) Google accounts, not something sharing the destination
folder can work around.

**Fix:** Uploads go through OAuth as Tarun himself instead (reusing the
same installed-app OAuth client as Gmail, a separate token/scope) — his
own account has real storage quota.

### Greenhouse adapter hangs intermittently on GitHub's runners — contained, not fixed

**What happened:** The Greenhouse source occasionally hangs on GitHub
Actions' runner in a way three independent timeout mechanisms — a
SIGALRM-based timeout, a per-request thread timeout, and a
`concurrent.futures` wall-clock wait — each failed to catch live, despite
passing tests and working reliably locally. When it happens, no slug's
future ever resolves or logs a timeout warning, suggesting GitHub-runner-
specific thread/GIL starvation that's never been reproduced or
root-caused.

**Fix (containment, not a real fix):** The workflow step's own
`timeout-minutes: 1` (tightened once a healthy run was confirmed to only
need ~1-2s) plus `continue-on-error: true` means a hang costs at most one
wasted minute and never blocks the other four ingestion sources from
completing. Low-priority, unresolved — revisit if it's ever worth the
time, but not urgent since it's fully contained.

**Lesson:** Not every bug needs to be root-caused before shipping — a
well-contained failure mode (bounded cost, doesn't cascade) can be an
acceptable place to stop, as long as it's honestly documented as
unresolved rather than quietly ignored.

### Jobs pipeline was scoring/tailoring resumes for roles Tarun wasn't a realistic candidate for

**What happened:** A single company's job board (Datadog was the
concrete example) dumps every open role — Staff, Senior, Manager,
Architect, entry-level — into the pipeline with no seniority filter. The
scorer and tailorer had no concept of "this title is obviously beyond
reach regardless of resume content," so real LLM calls and real tailored
resumes were being generated for roles that were never a realistic match.

**Fix:** Investigated via real production data (a `jobs gap-report` CLI
tool built specifically to look at this, not assumption) before building
anything. Added `_looks_senior()` — a whole-word regex over the parsed
job title (`staff`, `senior`, `principal`, `director`, `manager`,
`architect`, "Engineer II/III", etc.) — as an early skip in `run_tailor()`,
before any scoring LLM call. A one-time `reclassify-senior` command
cleaned up jobs that had already been scored/tailored under the old
behavior.

**Lesson:** When a hypothesis about *why* something looks wrong is
tempting (an earlier guess here was "SRE/DevOps tooling mismatch"), check
it against real data before building a fix — the actual cause here
(seniority, not domain mismatch) only became clear by querying production
jobs directly.

### WAAPI animations silently lost the EVE character's centering mid-animation

**What happened:** `EveIntro.tsx` positioned EVE via `translate(-50%,-50%)`
as a base CSS style, then animated her with the Web Animations API. During
the animation, she visibly drifted off-center at different window sizes.

**Root cause:** An *active* WAAPI animation entirely replaces the
`transform` property while it's running — it does not merge with or
build on the element's existing inline/CSS `transform`. Any static base
transform has to be restated inside *every keyframe* that also animates
`transform`, or centering (or any other static transform component) is
lost for the animation's duration.

**Fix:** Every keyframe that touches `transform` now also re-states
`translate(-50%,-50%)` alongside whatever else it's animating.

### SpeechRecognition threw "already started" even when that was the correct state

**What happened:** Calling `recognition.start()` right after `.stop()` (or
from `onend`'s auto-restart) sometimes threw `InvalidStateError:
already started` — even though the recognizer really was already in the
desired state.

**Root cause:** A real browser quirk: `.stop()` and the `onend` event
don't always finish tearing down the recognizer's internal session
synchronously. A `.start()` call landing in that gap throws, even though
"already running" is exactly the state being asked for.

**Fix:** Wrapped every `.start()`/`.stop()` call in try/catch, treating
the thrown "already started"/"already stopped" state as success rather
than an error to surface.

### Clicking "Next" during the SKYNET presentation closed the whole thing

**What happened:** `SkynetPresentation.tsx`'s Next/Back/dot-click handlers
call `cancelSpeech()` to cut off the current slide's narration — but the
resulting promise rejection arrives *asynchronously*, on a later tick,
after the click handler had already advanced `index` to the next slide.
A single shared boolean "cancelled" flag got reset to `false` by the new
slide's own effect run before that stale rejection's `.catch()` handler
read it, so it read the wrong (already-reset) value and mistakenly closed
the entire presentation.

**Fix:** Replaced the shared boolean with a generation counter — every
effect run increments it and captures its own id; a stale async callback
checks whether the generation is still current before acting, so a
rejection from a *previous* slide can never be mistaken for belonging to
the current one.

### The presentation heard and reacted to its own narration

**What happened:** SKYNET's public page has a single-utterance
grace-period "self-echo" guard (covers the gap between speech ending and
the mic finalizing a transcript of audio captured while still speaking).
The multi-slide presentation calls `speak()` directly for several minutes
of narration, which that guard was never sized for — she'd hear and
misfire on her own voice partway through.

**Fix:** Fully pause `SpeechRecognition` for the presentation's entire
duration instead of trying to extend the single-utterance guard window.
Trade-off, documented rather than hidden: voice "mute" can't interrupt a
presentation as a result — the panel's own Skip/Next/Back buttons are the
only way to control it while it's open.

### A bug fix accidentally caused the opposite bug: the first presentation slide read twice

**What happened:** The generation-counter fix above (for "Next closes the
presentation") accidentally dropped the effect's cleanup function in the
process. Without it, React's development-mode StrictMode double-invoke
(mount → cleanup → mount again) let a phantom first mount's `speak()` call
run all the way through uncancelled, and then the real mount narrated the
same slide again right after.

**Fix:** Restored a cleanup function that bumps the generation counter and
calls `cancelSpeech()` on unmount — invalidating the phantom mount's
callbacks and cutting its audio immediately.

**Lesson:** A fix for one race condition can introduce another if it
touches lifecycle/cleanup code — re-test the *other* known edge cases
(here, StrictMode's double-invoke) after any change to an effect's
cleanup, not just the specific bug being fixed.

### `speak()` could queue the same line twice back-to-back

**What happened:** `VoiceService.speak()` called
`window.speechSynthesis.cancel()` once, *before* awaiting the (async)
preferred-voice lookup, then enqueued its own utterance only after that
await resolved. Two overlapping `speak()` calls — most commonly React
StrictMode's double-invoke of an effect that calls `speak()` — could each
get past their own `cancel()` while the other was still mid-await, so
both utterances ended up enqueued back-to-back and both got spoken.

**Fix:** Cancel again immediately before actually enqueueing the new
utterance (after the await), not only before it. Whichever call finishes
its await last is guaranteed to cancel anything the other one already
enqueued.

### Mute/stop sometimes didn't actually stop speech

**What happened:** Reported live: clicking to mute (or saying "mute")
during a longer answer (a news readout) changed the UI state correctly,
but the audio kept playing anyway.

**Root cause:** A single `window.speechSynthesis.cancel()` call can
silently fail to stop an utterance that's already partway through
playing — real, observed browser flakiness, not a logic bug in the
click/command handling (which was already correct).

**Fix:** `cancelSpeech()` now pairs `cancel()` with `pause()` →
`cancel()` → `resume()`, which reliably kills the current utterance and
avoids leaving the speech engine stuck in a paused state that would
silently swallow the *next* `speak()` call.

## Part 2: Vercel Deployment (Mark V)

### 1. Vercel misdetected the whole repo as a Python/FastAPI project

**Symptom:** Build failed immediately with `Error: No FastAPI entrypoint
found in default locations`, listing `backend/app/main.py` and
`tests/test_health.py` as candidates.

**Cause:** This is a monorepo — `backend/` (Python) sits next to
`frontend/` (Next.js) at the repo root. Left at its default, Vercel's
zero-config framework detection scans the whole repo root, sees a
Python-shaped `backend/`, and guesses "FastAPI" instead of ever looking
inside `frontend/`.

**Fix:** In the Vercel project's **Settings → General → Root Directory**,
set it explicitly to `frontend`. Framework Preset should then auto-detect
as **Next.js**. If it doesn't, set that explicitly too (Settings →
General → Framework Preset) — a stale "Other"/Python preset can persist
even after Root Directory is corrected, and shows up as the Install
Command staying `pip install -r requirements.txt` instead of switching to
`npm install`.

### 2. `npm install` failed on Vercel but worked locally

**Symptom:** `npm error ERESOLVE could not resolve` — a peer-dependency
conflict between `vitest@5.0.1` (wants `@types/node@^22 || >=24`) and
`package.json`'s pinned `@types/node@^20`.

**Cause:** Locally, `node_modules` already had `@types/node@20.19.43`
installed from *before* `vitest` was bumped to `5.0.1` — a plain
`npm install` doesn't re-resolve peers from scratch when the package is
already present on disk, so the conflict sat there invisibly. Vercel's
build always starts from a clean `node_modules`, which forces a full
resolution and immediately hits the real conflict.

**Fix:** Bump `@types/node` to `^22` in `frontend/package.json` (still
satisfies `vite@8.3.0`'s own peer range), then regenerate
`package-lock.json` with a clean `rm -rf node_modules && npm install`
locally to verify before pushing. **Lesson:** a dependency bump that
"works fine locally" isn't proof it resolves cleanly — test with a clean
`node_modules`, since Vercel always builds from one.

### 3. Login always failed — three separate, stacked env var problems

This took the longest because each fix revealed the next problem
underneath it. Real root causes, in the order they were found:

#### 3a. `AUTH_PASSWORD_HASH_B64` got corrupted by the Vercel dashboard's paste field

**Symptom:** Login returned `{"error":"Incorrect username or password"}`
even when independently verifying (via a local script) that the typed
password matched the hash that was supposedly saved.

**Root cause:** Pasting the ~80-character base64 hash into Vercel's
masked "Secret"-type input field in the browser silently truncated or
otherwise corrupted it — a temporary diagnostic route confirmed the
*stored* value was only 12 characters and decoded to garbage, nowhere
near the real 80-character value.

**Fix:** Never paste a long secret into that masked dashboard field. Use
the Vercel CLI instead, piping the value directly so it never touches a
browser input:
```bash
node scripts/hash-password.mjs | tee /tmp/auth_out.txt
grep AUTH_USERNAME /tmp/auth_out.txt | cut -d'=' -f2 | tr -d '\n' | npx vercel env add AUTH_USERNAME production
grep AUTH_PASSWORD_HASH_B64 /tmp/auth_out.txt | cut -d'=' -f2 | tr -d '\n' | npx vercel env add AUTH_PASSWORD_HASH_B64 production
```
(`tr -d '\n'` matters — piping through `grep`/`cut` preserves the line's
trailing newline, which `pbcopy`-into-a-browser-field can carry into the
saved value as an invisible extra character.)

#### 3b. `SESSION_SECRET` was never set at all

**Symptom:** After fixing 3a, `curl`-ing `/api/auth/login` directly with
real credentials now correctly reported the credentials matched — but
the actual browser login still failed with a generic error.

**Root cause:** `vercel env ls production` showed `SESSION_SECRET`
completely absent from the list. It was simply never part of the original
env var setup. Real login calls `createSessionToken()` (to sign the
session JWT) only *after* password verification succeeds — a curl test
against a route that only checks credential matching, without also
creating a session, will never exercise this code path and will look
fully healthy while this is still broken.

**Fix:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" \
  | npx vercel env add SESSION_SECRET production
```

#### 3c. `DATABASE_URL` was wrong twice, in two different ways

**Symptom:** `/api/auth/webauthn/status` (and anything else touching the
DB) returned HTTP 500 with `Error: DATABASE_URL is not set`, even though
`vercel env ls` clearly showed `DATABASE_URL` present under Production.

**Root cause, part one:** The variable *existed* but its value was an
**empty string**. `if (!url) throw ...` in `lib/db.ts` treats an empty
string the same as "unset" — the error message says "not set" but really
means "set to nothing." A temporary diagnostic route
(`"DATABASE_URL" in process.env` vs. `process.env.DATABASE_URL.length`)
was what actually exposed this distinction; `vercel env ls` alone can't,
since it only shows that a key exists, not whether its value is empty.

**Root cause, part two:** After removing the empty value and re-adding it
by piping from the project's local `.env` file, the app could now reach
*a* database — just the wrong one. The resulting connection string was
exactly 48 characters, matching `backend/app/config.py`'s **local Docker
Postgres default** (`postgresql://skynet:skynet@localhost:5433/skynet`)
character-for-character. The local `.env` file was never actually updated
with the real Neon URL, because local dev has always run against
`docker compose`'s local Postgres instead. The real production Neon URL
only ever lived in **GitHub Actions Secrets** — which, being a secret,
cannot be read back by anyone (not the owner, not a CLI, not an AI
assistant) once set.

**Fix:** Pull the real connection string fresh from
[Neon's own console](https://console.neon.tech) (project → Connect →
copy the connection string) rather than assuming a local `.env` has
production values just because the app works locally:
```bash
printf '%s' 'the real neon connection string' | npx vercel env add DATABASE_URL production
```

**Lesson for all of 3a-3c:** After *any* env var change on Vercel, you
must trigger a new deployment — existing serverless functions don't pick
up env var changes live. `git commit --allow-empty -m "..." && git push`
is a clean way to force a redeploy without touching any code.

### 4. `vercel link` created an unwanted extra project

**Symptom:** Running `vercel link --yes` (with no `--project` flag, from
inside an already-linked-elsewhere state) silently created a brand new,
empty Vercel project called `frontend` instead of linking to the existing
`skynet` project.

**Cause:** Without an explicit `--project <name>`, `vercel link --yes`
defaults to creating a new project named after the current directory if
it can't unambiguously match an existing one.

**Fix:** Always pass the project name explicitly:
`vercel link --yes --project skynet`. The stray `frontend` project this
created is harmless but unused — delete it from the Vercel dashboard
(Settings → General → Delete Project) if it's still there.

## General takeaways

- **A masked/secret-type input field in a web dashboard is not a
  reliable way to paste a long value.** Prefer a CLI that pipes the value
  directly (`vercel env add <name> <env>` reading from stdin).
- **"The variable exists" and "the variable has the value you think it
  has" are different claims.** `vercel env ls` only proves the former.
  When a config-looks-right-but-still-fails situation drags on, add a
  temporary diagnostic route that reports lengths/prefixes (never full
  secret values) rather than continuing to guess.
- **A local `.env` is not guaranteed to hold the same values as
  production secrets**, especially for anything (like a database) that
  local dev has its own separate instance of via `docker compose`.
- **Env var changes need a fresh deployment to take effect** — Vercel
  bakes them into each deployment's serverless functions at deploy time,
  not live.
- **Test a dependency bump against a clean `node_modules`, not just the
  one already on disk** — a stale local install can hide a real peer
  conflict that only a fresh CI/Vercel install will hit.
