export interface DashboardJob {
  id: number;
  company: string;
  role: string;
  type: string | null;
  location: string | null;
  domain: string | null;
  user_decision: "applied" | "rejected" | null;
  status: string;
  apply_url: string | null;
  posted_date: string | null;
  created_at: string;
  score: number | null;
  gaps: string[] | null;
  visa_flag: boolean | null;
  drive_link: string | null;
  // The adapter that found this job — "greenhouse:<slug>", "lever:<slug>",
  // "telegram:<channel>", "gmail_linkedin", "share_bot", or "link_paste"
  // (see backend/app/sources/*.py's source_name values). Grouping/display
  // code should key off the prefix before ":" — see sourceGroup() in
  // lib/dashboard/sourceLabels.ts.
  source: string;
}

export interface DashboardStats {
  applied: number;
  rejected: number;
  pending: number;
  strongMatches: number;
  mediumMatches: number;
  lowMatches: number;
  newToday: number;
  resumesReady: number;
}

export interface JobFilters {
  decision: "all" | "pending" | "applied" | "rejected";
  minScore: number | null;
  domain: string | null;
  // A source *group* ("greenhouse", "telegram", ...) — see sourceGroup()
  // in lib/dashboard/sourceLabels.ts — not the raw parameterized value.
  source: string | null;
  search: string;
}

export const DEFAULT_FILTERS: JobFilters = {
  decision: "all",
  minScore: null,
  domain: null,
  source: null,
  search: "",
};

// The shape of a link_resume_requests row as returned by
// GET /api/dashboard/link-resume/[id] — shared by LinkResumePanel.tsx (the
// manual paste-a-link UI) and lib/voice/clipboardLink.ts (the hands-free
// voice path), so both poll the same real response shape instead of each
// keeping its own copy.
export interface LinkResumeRequestStatus {
  id: number;
  status: "pending" | "done" | "failed";
  score: number | null;
  drive_link: string | null;
  whatsapp_status: string | null;
  error: string | null;
}
