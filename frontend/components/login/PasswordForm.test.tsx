import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PasswordForm } from "./PasswordForm";

describe("PasswordForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onSuccess after a successful login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<PasswordForm onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/username/i), "tarun");
    await user.type(screen.getByLabelText(/^password$/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("shows the server's error message and does not call onSuccess on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Incorrect password" }) }),
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<PasswordForm onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/username/i), "tarun");
    await user.type(screen.getByLabelText(/^password$/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows a network-error message when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();

    render(<PasswordForm onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText(/username/i), "tarun");
    await user.type(screen.getByLabelText(/^password$/i), "anything");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/network error/i);
  });

  it("masks the password with * and reveals it via the eye button", async () => {
    const user = userEvent.setup();
    render(<PasswordForm onSuccess={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    await user.type(passwordInput, "secret");
    expect(passwordInput.value).toBe("******");

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(passwordInput.value).toBe("secret");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(passwordInput.value).toBe("******");
  });

  it("keeps the caret aligned with the * mask while typing and deleting", async () => {
    const user = userEvent.setup();
    render(<PasswordForm onSuccess={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    await user.type(passwordInput, "hunter2");
    expect(passwordInput.value).toBe("*******");
    expect(passwordInput.selectionStart).toBe(7);

    // Move to the middle and insert a character there.
    passwordInput.setSelectionRange(3, 3);
    await user.type(passwordInput, "X", { initialSelectionStart: 3, initialSelectionEnd: 3 });
    expect(passwordInput.value).toBe("********");
    expect(passwordInput.selectionStart).toBe(4);

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(passwordInput.value).toBe("hunXter2");
  });
});
