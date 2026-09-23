import { NextResponse } from "next/server";

import { listStoredCredentials } from "@/lib/auth/webauthn";

// Public (no session required) — the login page needs this before a
// session exists, to decide whether to offer "Sign in with Touch ID/Face
// ID" as a password alternative. Only ever reveals a boolean, never any
// credential detail.
export async function GET() {
  const credentials = await listStoredCredentials();
  return NextResponse.json({ hasCredential: credentials.length > 0 });
}
