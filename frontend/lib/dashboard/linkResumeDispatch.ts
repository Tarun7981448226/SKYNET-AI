// Triggers the on-demand pipeline (.github/workflows/link_resume.yml) via
// GitHub's workflow_dispatch REST API the moment a link is pasted, instead
// of waiting for the hourly pipeline.yml cron — this is what makes the
// dashboard's "paste a link" feature feel instant. Needs a GitHub PAT with
// the `actions:write` (repo) scope, since a workflow can't dispatch itself.
export class DispatchError extends Error {}

export async function dispatchLinkResumeWorkflow(url: string, requestId: number): Promise<void> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY; // "owner/repo"
  if (!token || !repository) {
    throw new DispatchError("GITHUB_DISPATCH_TOKEN / GITHUB_REPOSITORY not configured");
  }

  const res = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/link_resume.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { url, request_id: String(requestId) },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DispatchError(`GitHub workflow_dispatch failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
}
