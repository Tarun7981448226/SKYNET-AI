// jobs.source values are adapter-specific and often parameterized
// ("greenhouse:robinhood", "telegram:somechannel" — see
// backend/app/sources/*.py's source_name values and
// backend/app/cli.py:80's identical split(":")[0] pattern for the Source
// record's own `type`). The part before ":" is the actual adapter/channel
// type; the part after (if any) is a specific company/channel, not a
// separate category.
export function sourceGroup(source: string): string {
  return source.split(":")[0];
}

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  telegram: "Telegram Channels",
  share_bot: "Shared via Telegram",
  gmail_linkedin: "LinkedIn Alerts",
  link_paste: "Pasted Links",
};

export function sourceLabel(source: string): string {
  const group = sourceGroup(source);
  return SOURCE_LABELS[group] ?? group;
}

// The fixed set of real source groups the pipeline actually has adapters
// for — used to populate the dashboard's source filter dropdown (mirrors
// the domain filter's own fixed option list in Filters.tsx).
export const SOURCE_GROUP_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));
