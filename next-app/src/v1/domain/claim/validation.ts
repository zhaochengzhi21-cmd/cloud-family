import {
  CLAIM_ORIGIN_TYPE,
  CLAIM_SUBJECT_TYPE,
  RELATIONSHIP_TYPE,
  type ClaimOriginType,
  type ClaimSubjectType,
  type ClaimType,
  type RelationshipType,
} from "@/db/constants";
import { ClaimDomainError } from "./errors";
import { getClaimTypeDefinition, isRegisteredClaimType } from "./registry";
import type {
  ClaimValue,
  CreateClaimInput,
  RelationshipAssertionDirection,
  RelationshipAssertionValue,
  TextualClaimValue,
} from "./types";
import { normalizeClaimValue, normalizeTextualText } from "./normalization";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ASSERTION_DIRECTIONS: RelationshipAssertionDirection[] = [
  "SUBJECT_IS_PARENT_OF",
  "SUBJECT_IS_CHILD_OF",
  "SUBJECT_IS_SPOUSE_OF",
];

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new ClaimDomainError("INVALID_INPUT", `${field} must be a UUID`);
  }
}

function assertOrigin(o: string): ClaimOriginType {
  if (!(CLAIM_ORIGIN_TYPE as readonly string[]).includes(o)) {
    throw new ClaimDomainError("INVALID_INPUT", "invalid originType");
  }
  return o as ClaimOriginType;
}

function assertSubjectType(s: string): ClaimSubjectType {
  if (!(CLAIM_SUBJECT_TYPE as readonly string[]).includes(s)) {
    throw new ClaimDomainError("INVALID_INPUT", "invalid subjectType");
  }
  return s as ClaimSubjectType;
}

function parseTextualValue(raw: unknown): TextualClaimValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClaimDomainError("INVALID_INPUT", "value must be object with text");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.text !== "string") {
    throw new ClaimDomainError("INVALID_INPUT", "value.text required");
  }
  // Reject unknown keys that look like caller-supplied normalized_json
  if ("normalized" in obj || "normalizedJson" in obj) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      "caller must not supply normalized fields"
    );
  }
  return { text: normalizeTextualText(obj.text) };
}

function parseRelationshipAssertion(raw: unknown): RelationshipAssertionValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClaimDomainError("INVALID_INPUT", "assertion value must be object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.otherPersonId !== "string") {
    throw new ClaimDomainError("INVALID_INPUT", "otherPersonId required");
  }
  assertUuid(obj.otherPersonId, "otherPersonId");
  if (
    typeof obj.relationshipType !== "string" ||
    !(RELATIONSHIP_TYPE as readonly string[]).includes(obj.relationshipType)
  ) {
    throw new ClaimDomainError("INVALID_INPUT", "invalid relationshipType");
  }
  if (
    typeof obj.direction !== "string" ||
    !(ASSERTION_DIRECTIONS as readonly string[]).includes(obj.direction)
  ) {
    throw new ClaimDomainError("INVALID_INPUT", "invalid direction");
  }

  const relationshipType = obj.relationshipType as RelationshipType;
  const direction = obj.direction as RelationshipAssertionDirection;

  // Direction ↔ type coherence (foundation)
  if (direction === "SUBJECT_IS_SPOUSE_OF" && relationshipType !== "SPOUSE") {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      "SPOUSE direction requires SPOUSE type"
    );
  }
  if (
    (direction === "SUBJECT_IS_PARENT_OF" ||
      direction === "SUBJECT_IS_CHILD_OF") &&
    relationshipType === "SPOUSE"
  ) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      "parent/child direction cannot use SPOUSE"
    );
  }

  return {
    otherPersonId: obj.otherPersonId,
    relationshipType,
    direction,
  };
}

export function validateClaimValue(
  claimType: ClaimType,
  raw: unknown
): ClaimValue {
  const def = getClaimTypeDefinition(claimType);
  if (!def) {
    throw new ClaimDomainError("INVALID_INPUT", "unknown claim type");
  }
  if (def.kind === "TEXTUAL") {
    return parseTextualValue(raw);
  }
  return parseRelationshipAssertion(raw);
}

export type ValidatedCreateClaim = {
  familyId: string;
  subjectType: ClaimSubjectType;
  subjectId: string;
  claimType: ClaimType;
  value: ClaimValue;
  normalized: ClaimValue;
  confidence: number | null;
  originType: ClaimOriginType;
};

export function validateCreateClaimInput(
  input: CreateClaimInput
): ValidatedCreateClaim {
  assertUuid(input.familyId, "familyId");
  const subjectType = assertSubjectType(input.subjectType);
  assertUuid(input.subjectId, "subjectId");

  if (!isRegisteredClaimType(input.claimType)) {
    throw new ClaimDomainError("INVALID_INPUT", "unknown claim type");
  }
  const claimType = input.claimType;

  if (claimType === "RELATIONSHIP_ASSERTION" && subjectType !== "PERSON") {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      "RELATIONSHIP_ASSERTION requires PERSON subject"
    );
  }

  const value = validateClaimValue(claimType, input.value);
  const normalized = normalizeClaimValue(claimType, value);

  let confidence: number | null = null;
  if (input.confidence !== undefined && input.confidence !== null) {
    if (
      typeof input.confidence !== "number" ||
      Number.isNaN(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new ClaimDomainError("INVALID_INPUT", "confidence must be 0..1");
    }
    confidence = input.confidence;
  }

  const originType = assertOrigin(input.originType ?? "MANUAL");

  // AI hard rule: never auto-accept (create always PROPOSED anyway)
  if (originType === "AI_EXTRACTION" && confidence === null) {
    // allowed — confidence optional
  }

  return {
    familyId: input.familyId,
    subjectType,
    subjectId: input.subjectId,
    claimType,
    value,
    normalized,
    confidence,
    originType,
  };
}
