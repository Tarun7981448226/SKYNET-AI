import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getSql } from "@/lib/db";

// Query params: decision ("all" | "pending" | "applied" | "rejected"),
// minScore, domain, source, search (matches company or role), limit
// (default 50, capped at 200). Every filter is optional — the
// (`${x} is null or ...`) pattern lets one query handle any combination
// without building SQL strings by hand.
export async function GET(request: NextRequest) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const decisionParam = params.get("decision");
  const wantPending = decisionParam === "pending";
  const decisionFilter =
    decisionParam && decisionParam !== "all" && decisionParam !== "pending" ? decisionParam : null;
  // Rejecting a job should make it disappear from the default view, not
  // just get labeled — "all" means "everything still worth looking at,"
  // not literally everything. Explicitly picking the "Rejected" filter
  // still shows them.
  const excludeRejected = decisionFilter !== "rejected";
  const minScoreParam = params.get("minScore");
  const minScore = minScoreParam ? Number(minScoreParam) : null;
  const domain = params.get("domain") || null;
  // jobs.source is often parameterized ("greenhouse:robinhood",
  // "telegram:somechannel" — see backend/app/sources/*.py's source_name
  // values). "source" here is the group prefix (matches
  // lib/dashboard/sourceLabels.ts's sourceGroup()), so it needs an exact
  // match OR a "<source>:%" prefix match, not a plain equality check.
  const source = params.get("source") || null;
  const sourcePrefixPattern = source ? `${source}:%` : null;
  const searchParam = params.get("search");
  const searchPattern = searchParam ? `%${searchParam}%` : null;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);

  const sql = getSql();
  const rows = await sql`
    select
      j.id, j.company, j.role, j.type, j.location, j.domain, j.user_decision,
      j.status, j.apply_url, j.posted_date, j.created_at, j.source,
      f.score, f.gaps, f.visa_flag,
      t.drive_link
    from jobs j
    left join fit_scores f on f.job_id = j.id
    left join tailored_resumes t on t.job_id = j.id
    where
      -- "pending" matches the stats endpoint's definition: a resume is
      -- actually ready (status = 'tailored') and awaiting a decision —
      -- not just any undecided job, which would also sweep in
      -- unscored/flagged-no-resume jobs with nothing to act on yet.
      (${wantPending}::boolean is false or (j.user_decision is null and j.status = 'tailored'))
      and (${decisionFilter}::text is null or j.user_decision = ${decisionFilter})
      and (${excludeRejected}::boolean is false or j.user_decision is distinct from 'rejected')
      and (${minScore}::int is null or f.score >= ${minScore})
      and (${domain}::text is null or j.domain = ${domain})
      and (
        ${source}::text is null
        or j.source = ${source}
        or j.source like ${sourcePrefixPattern}
      )
      and (
        ${searchPattern}::text is null
        or j.company ilike ${searchPattern}
        or j.role ilike ${searchPattern}
      )
    order by j.created_at desc
    limit ${limit}
  `;

  return NextResponse.json({ jobs: rows });
}
