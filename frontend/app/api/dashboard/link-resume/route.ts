import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";
import { dispatchLinkResumeWorkflow } from "@/lib/dashboard/linkResumeDispatch";

// Inserts a link_resume_requests row (status="pending") and immediately
// triggers the on-demand GitHub Actions workflow that does the real
// scrape -> parse -> score -> tailor -> render -> Drive -> WhatsApp work
// (backend/app/cli.py's run_link_resume, via .github/workflows/
// link_resume.yml) — the credentials that pipeline needs (Gemini, Drive,
// WhatsApp) live only on the Python/Actions side, same as every other
// pipeline stage; this route never touches them.
export async function POST(request: NextRequest) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "url must be a valid http(s) link" }, { status: 400 });
  }
  // Defaults to true so the manual paste-a-link box and "score the link I
  // just copied" keep their existing always-deliver behavior; the voice
  // "tailor the resume for <company>" command is the one caller that
  // passes false, since it only wants the job tailored into the pending
  // dashboard, not pushed to Telegram.
  const sendTelegram = body.sendTelegram !== false;

  const sql = getSql();
  let requestId: number;
  try {
    const inserted = (await sql`
      insert into link_resume_requests (url, status) values (${url}, 'pending') returning id
    `) as { id: number }[];
    requestId = inserted[0].id;
  } catch (exc) {
    // This used to be an unhandled exception (an opaque 500 with no
    // indication of what broke) — logged here now since it's the only
    // place a genuine schema/connection problem with this table would
    // surface (2026-09-23: this is exactly how a missing-table bug went
    // unnoticed — nothing ever logged the real reason).
    console.error("link-resume insert failed:", exc);
    return NextResponse.json({ error: "Couldn't save that request. Try again in a moment." }, { status: 500 });
  }

  try {
    await dispatchLinkResumeWorkflow(url, requestId, sendTelegram);
  } catch (exc) {
    // The row stays "pending" forever otherwise — surface the dispatch
    // failure into the same status field the dashboard is about to poll,
    // rather than leaving it silently stuck.
    await sql`
      update link_resume_requests
      set status = 'failed', error = ${String(exc)}, completed_at = now()
      where id = ${requestId}
    `;
    console.error("link-resume dispatch failed:", exc);
    return NextResponse.json({ error: "Couldn't start processing that link. Try again in a moment." }, { status: 502 });
  }

  return NextResponse.json({ requestId });
}
