"use client";

export async function signOutRequest(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
