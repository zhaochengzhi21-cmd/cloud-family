import {
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from "@/db/constants";
import { RelationshipDomainError } from "./errors";
import { isParentRelationshipType } from "./types";
import type { CreateRelationshipInput } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new RelationshipDomainError(
      "INVALID_INPUT",
      `${field} must be a UUID`
    );
  }
}

/** Deterministic undirected SPOUSE ordering: min UUID → from, max → to. */
export function canonicalizeSpousePair(
  a: string,
  b: string
): { fromPersonId: string; toPersonId: string } {
  if (a === b) {
    throw new RelationshipDomainError("SELF_RELATIONSHIP");
  }
  return a < b
    ? { fromPersonId: a, toPersonId: b }
    : { fromPersonId: b, toPersonId: a };
}

export type NormalizedRelationshipEndpoints = {
  familyId: string;
  fromPersonId: string;
  toPersonId: string;
  relationshipType: RelationshipType;
};

/**
 * Parent types: personA = parent (from), personB = child (to).
 * SPOUSE: canonical UUID order.
 */
export function normalizeCreateRelationship(
  input: CreateRelationshipInput
): NormalizedRelationshipEndpoints {
  assertUuid(input.familyId, "familyId");
  assertUuid(input.personAId, "personAId");
  assertUuid(input.personBId, "personBId");
  if (
    !(RELATIONSHIP_TYPE as readonly string[]).includes(input.relationshipType)
  ) {
    throw new RelationshipDomainError("INVALID_INPUT", "invalid type");
  }
  if (input.personAId === input.personBId) {
    throw new RelationshipDomainError("SELF_RELATIONSHIP");
  }

  const type = input.relationshipType;
  if (type === "SPOUSE") {
    const pair = canonicalizeSpousePair(input.personAId, input.personBId);
    return {
      familyId: input.familyId,
      fromPersonId: pair.fromPersonId,
      toPersonId: pair.toPersonId,
      relationshipType: type,
    };
  }

  if (!isParentRelationshipType(type)) {
    throw new RelationshipDomainError("INVALID_INPUT", "unsupported type");
  }

  // personA = PARENT, personB = CHILD
  return {
    familyId: input.familyId,
    fromPersonId: input.personAId,
    toPersonId: input.personBId,
    relationshipType: type,
  };
}
