import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  createChallengeToken,
  SESSION_COOKIE_NAME,
  verifyChallengeToken,
  verifySessionToken,
  WEBAUTHN_CHALLENGE_COOKIE_NAME,
  WEBAUTHN_CHALLENGE_COOKIE_OPTIONS,
} from "@/lib/auth/session";
import { listStoredCredentials, rpConfig, saveCredential } from "@/lib/auth/webauthn";

// Passkey registration only ever happens for an already-authenticated
// session (password succeeded first) — this is "add a second factor for
// the one real user," not open self-signup, so both begin and finish
// require a valid session cookie.
async function requireSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySessionToken(token) : false;
}

export async function POST(request: NextRequest) {
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const cookieStore = await cookies();

  if (body.action === "begin") {
    const { rpID, rpName } = rpConfig();
    const existing = await listStoredCredentials();
    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userName: "tarun",
      userDisplayName: "Tarun Deep Reddy B V",
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
      // Without this, Chrome offers its full passkey chooser (including
      // "use a phone or tablet" QR/hybrid pairing) instead of going
      // straight to the Mac's own Touch ID/Face ID — "platform" restricts
      // the ceremony to the device's built-in authenticator only.
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    cookieStore.set(
      WEBAUTHN_CHALLENGE_COOKIE_NAME,
      await createChallengeToken(options.challenge),
      WEBAUTHN_CHALLENGE_COOKIE_OPTIONS,
    );
    return NextResponse.json(options);
  }

  if (body.action === "finish") {
    const challengeToken = cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE_NAME)?.value;
    const expectedChallenge = challengeToken ? await verifyChallengeToken(challengeToken) : null;
    if (!expectedChallenge) {
      return NextResponse.json({ error: "Registration challenge expired — try again" }, { status: 400 });
    }

    const { rpID, origins } = rpConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Passkey could not be verified" }, { status: 400 });
    }

    await saveCredential(verification.registrationInfo.credential, body.label ?? "Passkey");
    cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE_NAME);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
