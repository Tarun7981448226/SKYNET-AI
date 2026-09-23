import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";

// Same thresholds as backend/app/summary.py's nightly Telegram digest —
// keep both readings of "strong/medium/low match" consistent.
const STRONG_THRESHOLD = 75;
const MEDIUM_THRESHOLD = 50;

export async function GET(request: NextRequest) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sql = getSql();

  const [decisions, matches, newToday, resumesReady] = (await Promise.all([
    sql`
      select
        count(*) filter (where user_decision = 'applied') as applied,
        count(*) filter (where user_decision = 'rejected') as rejected,
        count(*) filter (where user_decision is null and status = 'tailored') as pending
      from jobs
    `,
    sql`
      select
        count(*) filter (where score > ${STRONG_THRESHOLD}) as strong,
        count(*) filter (where score >= ${MEDIUM_THRESHOLD} and score <= ${STRONG_THRESHOLD}) as medium,
        count(*) filter (where score < ${MEDIUM_THRESHOLD}) as low
      from fit_scores
    `,
    sql`select count(*) as count from jobs where created_at >= (now() - interval '24 hours')`,
    sql`select count(*) as count from tailored_resumes`,
  ])) as Record<string, string>[][];

  return NextResponse.json({
    applied: Number(decisions[0].applied),
    rejected: Number(decisions[0].rejected),
    pending: Number(decisions[0].pending),
    strongMatches: Number(matches[0].strong),
    mediumMatches: Number(matches[0].medium),
    lowMatches: Number(matches[0].low),
    newToday: Number(newToday[0].count),
    resumesReady: Number(resumesReady[0].count),
  });
}
