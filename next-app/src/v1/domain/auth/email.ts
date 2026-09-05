import { AuthDomainError } from "./errors";
import { EMAIL_MAX_LENGTH } from "./types";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Canonical email identity for lookup/crypto.
 * trim → NFC → lowercase; basic format check; max 254.
 */
export function normalizeEmail(raw: string): string {
  if (typeof raw !== "string") {
    throw new AuthDomainError("INVALID_EMAIL");
  }
  const trimmed = raw.trim().normalize("NFC");
  if (!trimmed || CONTROL_CHARS.test(trimmed)) {
    throw new AuthDomainError("INVALID_EMAIL");
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    throw new AuthDomainError("INVALID_EMAIL");
  }
  const lower = trimmed.toLowerCase();
  // Practical validation — not full RFC 5322
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
    throw new AuthDomainError("INVALID_EMAIL");
  }
  const [local, domain] = lower.split("@");
  if (!local || !domain || domain.includes("..")) {
    throw new AuthDomainError("INVALID_EMAIL");
  }
  return lower;
}
