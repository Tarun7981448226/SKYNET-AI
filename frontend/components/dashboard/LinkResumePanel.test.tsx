import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkResumePanel } from "./LinkResumePanel";

function fillAndSubmit(url: string) {
  fireEvent.change(screen.getByPlaceholderText(/https:\/\/company.com/i), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: /score, tailor, and send/i }));
}

describe("LinkResumePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("submits a link, shows pending, then polls to the done state", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requestId: 42 }) }) // POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42,
          status: "done",
          score: 88,
          drive_link: "https://drive.google.com/file/d/abc/view",
          whatsapp_status: "sent",
          error: null,
        }),
      }); // first poll
    vi.stubGlobal("fetch", fetchMock);

    render(<LinkResumePanel />);
    fillAndSubmit("https://example.com/jobs/1");

    // Flushes the POST's promise resolution and the resulting state update.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Reading the posting/i)).toBeInTheDocument();

    // Fires the poll interval and flushes its GET's resolution too.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole("link", { name: "View resume" }).closest("span")?.textContent).toContain(
      "Fit score 88. Sent to Telegram.",
    );
    expect(screen.getByRole("link", { name: "View resume" })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/abc/view",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/dashboard/link-resume",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/dashboard/link-resume/42");
  });

  it("shows the submit error and never starts polling if the POST fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Couldn't start processing that link. Try again in a moment." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LinkResumePanel />);
    await user.type(screen.getByPlaceholderText(/https:\/\/company.com/i), "https://example.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /score, tailor, and send/i }));

    await waitFor(() => expect(screen.getByText(/Couldn't start processing/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the failure message once a request fails during processing", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ requestId: 7 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 7,
          status: "failed",
          score: null,
          drive_link: null,
          whatsapp_status: null,
          error: "that link doesn't look like a job posting",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<LinkResumePanel />);
    fillAndSubmit("https://example.com/blog");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("that link doesn't look like a job posting")).toBeInTheDocument();
  });
});
