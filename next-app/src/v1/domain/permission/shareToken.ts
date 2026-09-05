import { createHash, randomBytes } from "crypto";

/** CSPRNG share token — ≥32 bytes, base64url. Never persist raw. */
export function generateShareRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256(rawToken) hex — only form stored in DB. */
export function hashShareToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Entropy check for smoke: decode base64url length in bytes. */
export function shareTokenByteLength(rawToken: string): number {
  const pad = rawToken.length % 4 === 0 ? 0 : 4 - (rawToken.length % 4);
  const b64 = rawToken.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64").length;
}
