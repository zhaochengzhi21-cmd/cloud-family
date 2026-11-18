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
const STORY_TEXT_MAX = 8000;
const NARRATOR_MAX = 80;

function hasControlChars(s: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (allowNewlines && (c === 10 || c === 13)) continue;
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** Normalize free-text claim content (short facts). */
export function normalizeTextualText(raw: string): string {
  const nfc = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!nfc) {
    throw new ClaimDomainError("INVALID_INPUT", "text must be non-empty");
  }
  if (nfc.length > TEXT_MAX) {
    throw new ClaimDomainError("INVALID_INPUT", `text max ${TEXT_MAX} chars`);
  }
  if (hasControlChars(nfc, false)) {
    throw new ClaimDomainError("INVALID_INPUT", "text has control chars");
  }
  return nfc;
}

/** Normalize long-form story text — keeps paragraph breaks. */
export function normalizeStoryText(raw: string): string {
  const nfc = raw
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!nfc) {
    throw new ClaimDomainError("INVALID_INPUT", "text must be non-empty");
  }
  if (nfc.length > STORY_TEXT_MAX) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      `text max ${STORY_TEXT_MAX} chars`
    );
  }
  if (hasControlChars(nfc, true)) {
    throw new ClaimDomainError("INVALID_INPUT", "text has control chars");
  }
  return nfc;
}

export function normalizeNarrator(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const nfc = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!nfc) return null;
  if (nfc.length > NARRATOR_MAX) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      `narrator max ${NARRATOR_MAX} chars`
    );
  }
  if (hasControlChars(nfc, false)) {
    throw new ClaimDomainError("INVALID_INPUT", "narrator has control chars");
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
    const text =
      claimType === "STORY"
        ? normalizeStoryText(v.text)
        : normalizeTextualText(v.text);
    const narrator =
      claimType === "STORY" ? normalizeNarrator(v.narrator) : null;
    return narrator ? { text, narrator } : { text };
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
