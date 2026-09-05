/**
 * Lazy V1 Auth config — missing env must not crash Legacy import/build.
 * Keys are base64-encoded 32-byte secrets.
 */

import { AuthDomainError } from "./errors";
import { CURRENT_EMAIL_KEY_VERSION } from "./types";

export type V1AuthConfig = {
  emailLookupKey: Buffer;
  emailEncryptionKey: Buffer;
  otpHashKey: Buffer;
  emailKeyVersion: number;
};

let cached: V1AuthConfig | null = null;

function decodeKey(name: string, raw: string | undefined): Buffer {
  if (!raw || !raw.trim()) {
    throw new AuthDomainError(
      "AUTH_CONFIGURATION_ERROR",
      `${name} is not configured`
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new AuthDomainError(
      "AUTH_CONFIGURATION_ERROR",
      `${name} is invalid`
    );
  }
  if (buf.length < 32) {
    throw new AuthDomainError(
      "AUTH_CONFIGURATION_ERROR",
      `${name} must be at least 32 bytes`
    );
  }
  // AES-256 requires exactly 32 bytes — use first 32 if longer
  return buf.subarray(0, 32);
}

export function isV1AuthConfigured(): boolean {
  return Boolean(
    process.env.V1_EMAIL_LOOKUP_KEY?.trim() &&
      process.env.V1_EMAIL_ENCRYPTION_KEY_V1?.trim() &&
      process.env.V1_OTP_HASH_KEY?.trim()
  );
}

export function getV1AuthConfig(): V1AuthConfig {
  if (cached) return cached;
  cached = {
    emailLookupKey: decodeKey(
      "V1_EMAIL_LOOKUP_KEY",
      process.env.V1_EMAIL_LOOKUP_KEY
    ),
    emailEncryptionKey: decodeKey(
      "V1_EMAIL_ENCRYPTION_KEY_V1",
      process.env.V1_EMAIL_ENCRYPTION_KEY_V1
    ),
    otpHashKey: decodeKey("V1_OTP_HASH_KEY", process.env.V1_OTP_HASH_KEY),
    emailKeyVersion: CURRENT_EMAIL_KEY_VERSION,
  };
  return cached;
}

/** Test helper — clear cache after env changes. */
export function resetV1AuthConfigCache(): void {
  cached = null;
}
