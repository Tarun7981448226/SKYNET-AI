import type { DashboardStats } from "@/lib/dashboard/types";

const TILES: { key: keyof DashboardStats; label: string }[] = [
  { key: "newToday", label: "New Today" },
  { key: "strongMatches", label: "Strong Matches" },
  { key: "resumesReady", label: "Resumes Ready" },
  { key: "pending", label: "Pending Decision" },
  { key: "applied", label: "Applied" },
  { key: "rejected", label: "Rejected" },
];

export function StatsBar({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TILES.map(({ key, label }) => (
        <div key={key} className="glass-panel px-4 py-3">
          <div className="text-2xl font-semibold text-[var(--foreground)]">{stats[key]}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.15em] text-[var(--foreground)]/60">{label}</div>
        </div>
      ))}
    </div>
  );
}
