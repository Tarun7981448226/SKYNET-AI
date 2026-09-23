import bcrypt from "bcryptjs";

// bcryptjs (pure JS) rather than the native `bcrypt` package — avoids
// native-binary bundling issues in Vercel's serverless functions.

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 12);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
