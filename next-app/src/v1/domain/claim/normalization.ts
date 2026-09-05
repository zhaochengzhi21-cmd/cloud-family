/**
 * Claim value normalization — caller never supplies normalized_json.
 * Foundation: trim + NFC + whitespace collapse. No calendar / geocode / AI.
 */

import type { ClaimType } from "@/db/constants";
import { ClaimDomainError } from "./errors";
import { getClaimTypeDefinition } from "./registry";
import type {
  ClaimValue,
  RelationshipAssertionValue,
  TextualClaimValue,
} from "./types";
import { canonicalizeJson } from "./canonicalize";
import { createHash } from "crypto";

const TEXT_MAX = 500;

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** Normalize free-text claim content. */
export function normalizeTextualText(raw: string): string {
  const nfc = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!nfc) {
    throw new ClaimDomainError("INVALID_INPUT", "text must be non-empty");
  }
  if (nfc.length > TEXT_MAX) {
    throw new ClaimDomainError("INVALID_INPUT", `text max ${TEXT_MAX} chars`);
  }
  if (hasControlChars(nfc)) {
    throw new ClaimDomainError("INVALID_INPUT", "text has control chars");
  }
  return nfc;
}

export function normalizeClaimValue(
  claimType: ClaimType,
  value: ClaimValue
): ClaimValue {
  const def = getClaimTypeDefinition(claimType);
  if (!def) {
    throw new ClaimDomainError("INVALID_INPUT", "unknown claim type");
  }

  if (def.kind === "TEXTUAL") {
    const v = value as TextualClaimValue;
    return { text: normalizeTextualText(v.text) };
  }

  const v = value as RelationshipAssertionValue;
  return {
    otherPersonId: v.otherPersonId,
    relationshipType: v.relationshipType,
    direction: v.direction,
  };
}

/**
 * SHA-256 of canonicalJSON({ claimType, normalizedValue }).
 * Never log or print the fingerprint in reports.
 */
export function computeValueFingerprint(
  claimType: ClaimType,
  normalizedValue: ClaimValue
): string {
  const payload = canonicalizeJson({
    claimType,
    normalizedValue,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
