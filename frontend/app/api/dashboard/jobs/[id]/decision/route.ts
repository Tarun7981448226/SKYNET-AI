import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";

// Writes jobs.user_decision — deliberately separate from the pipeline's
// own `status` column (see backend/app/models/job.py), so this never
// interferes with run_tailor()'s own processing queries.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const decision = body.decision;
  if (decision !== "applied" && decision !== "rejected" && decision !== null) {
    return NextResponse.json({ error: "decision must be \"applied\", \"rejected\", or null" }, { status: 400 });
  }

  const sql = getSql();
  const result = (await sql`
    update jobs set user_decision = ${decision} where id = ${jobId} returning id
  `) as { id: number }[];
  if (result.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
