import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  createChallengeToken,
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  verifyChallengeToken,
  WEBAUTHN_CHALLENGE_COOKIE_NAME,
  WEBAUTHN_CHALLENGE_COOKIE_OPTIONS,
} from "@/lib/auth/session";
import {
  getStoredCredential,
  listStoredCredentials,
  rowToWebAuthnCredential,
  rpConfig,
  updateSignCount,
} from "@/lib/auth/webauthn";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cookieStore = await cookies();

  if (body.action === "begin") {
    const { rpID } = rpConfig();
    const existing = await listStoredCredentials();
    if (existing.length === 0) {
      return NextResponse.json({ error: "No passkey registered yet — sign in with your password first" }, { status: 400 });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
      userVerification: "preferred",
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
      return NextResponse.json({ error: "Login challenge expired — try again" }, { status: 400 });
    }

    const response = body.response as AuthenticationResponseJSON;
    const storedRow = await getStoredCredential(response.id);
    if (!storedRow) {
      return NextResponse.json({ error: "Unrecognized passkey" }, { status: 400 });
    }

    const { rpID, origins } = rpConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: rowToWebAuthnCredential(storedRow),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!verification.verified) {
      return NextResponse.json({ error: "Passkey could not be verified" }, { status: 400 });
    }

    await updateSignCount(storedRow.credential_id, verification.authenticationInfo.newCounter);
    cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE_NAME);
    cookieStore.set(SESSION_COOKIE_NAME, await createSessionToken(), SESSION_COOKIE_OPTIONS);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
