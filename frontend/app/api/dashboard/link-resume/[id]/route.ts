import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";

// Polled by the dashboard's paste-a-link panel while a request is
// "pending" — the GitHub Actions run that actually does the work
// (link_resume.yml) isn't synchronous from this route's point of view, so
// the UI checks back on this row instead of blocking the original POST.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }

  const sql = getSql();
  const rows = (await sql`
    select id, url, status, job_id, score, drive_link, whatsapp_status, error, requested_at, completed_at
    from link_resume_requests
    where id = ${requestId}
  `) as {
    id: number;
    url: string;
    status: string;
    job_id: number | null;
    score: number | null;
    drive_link: string | null;
    whatsapp_status: string | null;
    error: string | null;
    requested_at: string;
    completed_at: string | null;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
