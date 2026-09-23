import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  // Stored base64-encoded (AUTH_PASSWORD_HASH_B64), not as the raw bcrypt
  // hash: Next.js's env loader does shell-like `$...` expansion, which
  // silently corrupts a bcrypt hash's literal `$2b$12$...` segments if
  // stored directly — confirmed while testing this locally.
  const passwordHashB64 = process.env.AUTH_PASSWORD_HASH_B64;
  if (!passwordHashB64) {
    return NextResponse.json({ error: "Login is not configured" }, { status: 500 });
  }
  const passwordHash = Buffer.from(passwordHashB64, "base64").toString("utf8");
  const expectedUsername = process.env.AUTH_USERNAME;
  if (!expectedUsername) {
    return NextResponse.json({ error: "Login is not configured" }, { status: 500 });
  }

  let username: unknown;
  let password: unknown;
  try {
    ({ username, password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  // Username isn't secret (it's not the security boundary, the password
  // is) — a plain case-insensitive compare is fine, no need for the
  // constant-time handling the password hash gets.
  const usernameMatches = username.trim().toLowerCase() === expectedUsername.trim().toLowerCase();
  const passwordMatches = await verifyPassword(password, passwordHash);
  if (!usernameMatches || !passwordMatches) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);

  return NextResponse.json({ ok: true });
}
