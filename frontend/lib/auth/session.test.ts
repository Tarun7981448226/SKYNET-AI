// @vitest-environment node
//
// jose's key-type check is a strict `instanceof Uint8Array`, and jsdom's
// realm creates its own Uint8Array constructor distinct from Node's — the
// default jsdom environment fails that check even though the value is a
// real Uint8Array. This file doesn't touch the DOM, so run it under plain
// Node instead of switching the whole project off jsdom.
import { beforeAll, describe, expect, it } from "vitest";

import { createChallengeToken, createSessionToken, verifyChallengeToken, verifySessionToken } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-only-secret-do-not-use-in-production";
});

describe("session tokens", () => {
  it("verifies a token it just created", async () => {
    const token = await createSessionToken();
    await expect(verifySessionToken(token)).resolves.toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken();
    const tampered = token.slice(0, -4) + "abcd";
    await expect(verifySessionToken(tampered)).resolves.toBe(false);
  });

  it("rejects garbage input", async () => {
    await expect(verifySessionToken("not-a-jwt-at-all")).resolves.toBe(false);
  });
});

describe("webauthn challenge tokens", () => {
  it("round-trips the exact challenge string", async () => {
    const token = await createChallengeToken("random-challenge-value-123");
    await expect(verifyChallengeToken(token)).resolves.toBe("random-challenge-value-123");
  });

  it("returns null for a tampered challenge token", async () => {
    const token = await createChallengeToken("some-challenge");
    const tampered = token.slice(0, -4) + "abcd";
    await expect(verifyChallengeToken(tampered)).resolves.toBeNull();
  });
});
