import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { AuthDomainError } from "./errors";
import {
  CURRENT_EMAIL_KEY_VERSION,
  EMAIL_CIPHER_FORMAT_V1,
} from "./types";
import { getV1AuthConfig } from "./config";

/**
 * Deterministic email lookup: HMAC-SHA256(secret, canonicalEmail).
 */
export function computeEmailLookupHash(canonicalEmail: string): string {
  const { emailLookupKey } = getV1AuthConfig();
  return createHmac("sha256", emailLookupKey)
    .update(canonicalEmail, "utf8")
    .digest("hex");
}

/**
 * AES-256-GCM envelope (bytea):
 * [1 byte format][12 byte nonce][16 byte tag][ciphertext...]
 */
export function encryptEmail(canonicalEmail: string): {
  ciphertext: Buffer;
  keyVersion: number;
} {
  const { emailEncryptionKey } = getV1AuthConfig();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", emailEncryptionKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(canonicalEmail, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([
    Buffer.from([EMAIL_CIPHER_FORMAT_V1]),
    nonce,
    tag,
    encrypted,
  ]);
  return { ciphertext: envelope, keyVersion: CURRENT_EMAIL_KEY_VERSION };
}

export function decryptEmail(
  ciphertext: Buffer,
  keyVersion: number
): string {
  const { emailEncryptionKey, emailKeyVersion } = getV1AuthConfig();
  if (keyVersion !== emailKeyVersion) {
    throw new AuthDomainError("AUTH_CONFIGURATION_ERROR");
  }
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 1 + 12 + 16 + 1) {
    throw new AuthDomainError("AUTH_CONFIGURATION_ERROR");
  }
  if (ciphertext[0] !== EMAIL_CIPHER_FORMAT_V1) {
    throw new AuthDomainError("AUTH_CONFIGURATION_ERROR");
  }
  const nonce = ciphertext.subarray(1, 13);
  const tag = ciphertext.subarray(13, 29);
  const data = ciphertext.subarray(29);
  try {
    const decipher = createDecipheriv("aes-256-gcm", emailEncryptionKey, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new AuthDomainError("AUTH_CONFIGURATION_ERROR");
  }
}

export function computeOtpDigest(challengeId: string, code: string): string {
  const { otpHashKey } = getV1AuthConfig();
  return createHmac("sha256", otpHashKey)
    .update(`${challengeId}:${code}`, "utf8")
    .digest("hex");
}

export function timingSafeEqualDigest(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, Buffer.alloc(ba.length));
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** High-entropy opaque session token — SHA-256 digest only in DB. */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
