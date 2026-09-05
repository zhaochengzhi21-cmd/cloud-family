import {
  CLAIM_EVIDENCE_RELATION,
  EVIDENCE_TYPE,
  EVIDENCE_VISIBILITY,
  type ClaimEvidenceRelation,
  type EvidenceType,
  type EvidenceVisibility,
} from "@/db/constants";
import { EvidenceDomainError } from "./errors";
import type { CreateEvidenceInput, LinkEvidenceInput } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LIMITS = {
  title: 200,
  description: 5000,
  sourceLocator: 500,
  sourceDateText: 200,
} as const;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new EvidenceDomainError("INVALID_INPUT", `${field} must be a UUID`);
  }
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

function normalizeOptionalText(
  raw: string | null | undefined,
  field: keyof typeof LIMITS
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new EvidenceDomainError("INVALID_INPUT", `${field} must be string`);
  }
  const n = raw.normalize("NFC").trim();
  if (!n) return null;
  if (n.length > LIMITS[field]) {
    throw new EvidenceDomainError(
      "INVALID_INPUT",
      `${field} max ${LIMITS[field]} chars`
    );
  }
  if (hasControlChars(n)) {
    throw new EvidenceDomainError(
      "INVALID_INPUT",
      `${field} has control chars`
    );
  }
  return n;
}

export type ValidatedCreateEvidence = {
  familyId: string;
  evidenceType: EvidenceType;
  title: string | null;
  description: string | null;
  mediaObjectId: string | null;
  sourceLocator: string | null;
  sourceDateText: string | null;
  visibility: EvidenceVisibility;
};

export function validateCreateEvidenceInput(
  input: CreateEvidenceInput
): ValidatedCreateEvidence {
  assertUuid(input.familyId, "familyId");

  if (!(EVIDENCE_TYPE as readonly string[]).includes(input.evidenceType)) {
    throw new EvidenceDomainError("INVALID_INPUT", "invalid evidenceType");
  }

  const visibility = (input.visibility ?? "FAMILY") as EvidenceVisibility;
  if (!(EVIDENCE_VISIBILITY as readonly string[]).includes(visibility)) {
    throw new EvidenceDomainError("INVALID_INPUT", "invalid visibility");
  }

  let mediaObjectId: string | null = null;
  if (input.mediaObjectId != null) {
    assertUuid(input.mediaObjectId, "mediaObjectId");
    mediaObjectId = input.mediaObjectId;
  }

  return {
    familyId: input.familyId,
    evidenceType: input.evidenceType,
    title: normalizeOptionalText(input.title, "title"),
    description: normalizeOptionalText(input.description, "description"),
    mediaObjectId,
    sourceLocator: normalizeOptionalText(input.sourceLocator, "sourceLocator"),
    sourceDateText: normalizeOptionalText(
      input.sourceDateText,
      "sourceDateText"
    ),
    visibility,
  };
}

export type ValidatedLinkEvidence = {
  familyId: string;
  claimId: string;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
};

export function validateLinkEvidenceInput(
  input: LinkEvidenceInput
): ValidatedLinkEvidence {
  assertUuid(input.familyId, "familyId");
  assertUuid(input.claimId, "claimId");
  assertUuid(input.evidenceId, "evidenceId");
  if (
    !(CLAIM_EVIDENCE_RELATION as readonly string[]).includes(input.relation)
  ) {
    throw new EvidenceDomainError("INVALID_INPUT", "invalid relation");
  }
  return {
    familyId: input.familyId,
    claimId: input.claimId,
    evidenceId: input.evidenceId,
    relation: input.relation,
  };
}
