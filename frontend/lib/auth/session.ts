import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";

// Single-user app — a self-contained signed JWT in an httpOnly cookie is
// simplest (no session table to manage). jose is Edge-runtime compatible,
// which matters because proxy.ts (Next 16's renamed middleware) runs on
// the Edge runtime and needs to verify this same token.

export const SESSION_COOKIE_NAME = "skynet_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_SUBJECT = "tarun";

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: SESSION_SUBJECT })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload.sub === SESSION_SUBJECT;
  } catch {
    return false;
  }
}

// proxy.ts already blocks unauthenticated requests to /api/dashboard/:path*
// before they reach a route at all, but per Next's own guidance that
// shouldn't be the only check — each protected route re-verifies too.
export async function requireSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : false;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

// Holds the in-flight WebAuthn challenge between the "begin" and "finish"
// Route Handler calls — not persisted to the DB, just a short-lived signed
// cookie (5 min covers even a slow Touch ID/Face ID prompt).
export const WEBAUTHN_CHALLENGE_COOKIE_NAME = "skynet_webauthn_challenge";
const CHALLENGE_TTL_SECONDS = 60 * 5;

export async function createChallengeToken(challenge: string): Promise<string> {
  return new SignJWT({ challenge })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyChallengeToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return typeof payload.challenge === "string" ? payload.challenge : null;
  } catch {
    return null;
  }
}

export const WEBAUTHN_CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: CHALLENGE_TTL_SECONDS,
};
