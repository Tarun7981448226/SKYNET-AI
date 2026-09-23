#!/usr/bin/env node
// Run locally to compute AUTH_USERNAME + AUTH_PASSWORD_HASH_B64 — the
// plaintext password never leaves your terminal (not printed, not sent
// anywhere but bcrypt's in-memory hash function).
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";

const rl = createInterface({ input: stdin, output: stdout });

const username = await rl.question("Username: ");
// Basic no-echo prompt: readline has no built-in masking, so we just warn
// the user rather than hand-rolling raw-mode keystroke suppression, which
// is easy to get subtly wrong across terminals.
console.log("(Your password will be visible as you type — make sure no one's watching your screen.)");
const password = await rl.question("Password to hash: ");
rl.close();

if (!username || !password) {
  console.error("Both a username and password are required.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const encoded = Buffer.from(hash, "utf8").toString("base64");
console.log("\nAUTH_USERNAME=" + username);
console.log("AUTH_PASSWORD_HASH_B64=" + encoded);
console.log(
  "\n(the hash is base64-encoded, not the raw bcrypt hash — Next.js's env loader does shell-like",
  "\n$-expansion that corrupts a bcrypt hash's literal $2b$12$... segments otherwise.)",
);
console.log("\nSet both as env vars in Vercel (and .env.local for local dev) — never commit them.");
