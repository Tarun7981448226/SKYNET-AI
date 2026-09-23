import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { WebAuthnCredential } from "@simplewebauthn/server";

import { getSql } from "@/lib/db";

export function rpConfig() {
  const rpID = process.env.RP_ID;
  const rpName = process.env.RP_NAME ?? "SKYNET";
  const originEnv = process.env.RP_ORIGIN;
  if (!rpID || !originEnv) {
    throw new Error("RP_ID and RP_ORIGIN must be set for WebAuthn");
  }
  const origins = originEnv.split(",").map((o) => o.trim());
  return { rpID, rpName, origins };
}

type CredentialRow = {
  id: number;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[] | null;
  label: string | null;
};

export async function listStoredCredentials(): Promise<CredentialRow[]> {
  const sql = getSql();
  const rows = (await sql`
    select id, credential_id, public_key, sign_count, transports, label
    from webauthn_credentials
  `) as CredentialRow[];
  return rows;
}

export async function getStoredCredential(credentialId: string): Promise<CredentialRow | null> {
  const sql = getSql();
  const rows = (await sql`
    select id, credential_id, public_key, sign_count, transports, label
    from webauthn_credentials
    where credential_id = ${credentialId}
  `) as CredentialRow[];
  return rows[0] ?? null;
}

export function rowToWebAuthnCredential(row: CredentialRow): WebAuthnCredential {
  return {
    id: row.credential_id,
    publicKey: isoBase64URL.toBuffer(row.public_key),
    counter: row.sign_count,
    transports: row.transports ?? undefined,
  };
}

export async function saveCredential(
  credential: WebAuthnCredential,
  label: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into webauthn_credentials (credential_id, public_key, sign_count, transports, label)
    values (
      ${credential.id},
      ${isoBase64URL.fromBuffer(credential.publicKey)},
      ${credential.counter},
      ${JSON.stringify(credential.transports ?? [])},
      ${label}
    )
  `;
}

export async function updateSignCount(credentialId: string, newCounter: number): Promise<void> {
  const sql = getSql();
  await sql`
    update webauthn_credentials set sign_count = ${newCounter} where credential_id = ${credentialId}
  `;
}
