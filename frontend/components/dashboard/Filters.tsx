import { SOURCE_GROUP_OPTIONS } from "@/lib/dashboard/sourceLabels";
import type { JobFilters } from "@/lib/dashboard/types";

const DECISION_OPTIONS: { value: JobFilters["decision"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
];

const DOMAIN_OPTIONS = ["ai_ml", "swe", "data_science", "other"];

export function Filters({
  filters,
  onChange,
}: {
  filters: JobFilters;
  onChange: (next: JobFilters) => void;
}) {
  return (
    <div className="glass-panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        {DECISION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ ...filters, decision: opt.value })}
            className={`rounded-full px-3 py-1 text-xs ${
              filters.decision === opt.value
                ? "bg-[var(--glow-primary)]/30 text-[var(--foreground)]"
                : "text-[var(--foreground)]/60 hover:text-[var(--foreground)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <select
        aria-label="Domain"
        value={filters.domain ?? ""}
        onChange={(event) => onChange({ ...filters, domain: event.target.value || null })}
        className="rounded-lg border-none bg-white/5 px-2 py-1 text-xs text-[var(--foreground)]"
      >
        <option value="">All domains</option>
        {DOMAIN_OPTIONS.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>

      <select
        aria-label="Source"
        value={filters.source ?? ""}
        onChange={(event) => onChange({ ...filters, source: event.target.value || null })}
        className="rounded-lg border-none bg-white/5 px-2 py-1 text-xs text-[var(--foreground)]"
      >
        <option value="">All sources</option>
        {SOURCE_GROUP_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <input
        type="number"
        min={0}
        max={100}
        placeholder="Min score"
        value={filters.minScore ?? ""}
        onChange={(event) =>
          onChange({ ...filters, minScore: event.target.value ? Number(event.target.value) : null })
        }
        className="w-24 rounded-lg border-none bg-white/5 px-2 py-1 text-xs text-[var(--foreground)]"
      />

      <input
        type="text"
        placeholder="Search company or role"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        className="min-w-[10rem] flex-1 rounded-lg border-none bg-white/5 px-2 py-1 text-xs text-[var(--foreground)]"
      />
    </div>
  );
}
