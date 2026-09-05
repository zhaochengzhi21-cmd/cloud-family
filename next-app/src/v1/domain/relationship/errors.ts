export const RELATIONSHIP_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "PERSON_NOT_FOUND",
  "PERSON_DELETED",
  "CROSS_FAMILY_RELATIONSHIP",
  "SELF_RELATIONSHIP",
  "DUPLICATE_RELATIONSHIP",
  "ANCESTRY_CYCLE",
  "RELATIONSHIP_NOT_FOUND",
  "GRAPH_CYCLE_DETECTED",
] as const;

export type RelationshipErrorCode = (typeof RELATIONSHIP_ERROR_CODES)[number];

export class RelationshipDomainError extends Error {
  readonly code: RelationshipErrorCode;

  constructor(code: RelationshipErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RelationshipDomainError";
    this.code = code;
  }
}

export function isRelationshipDomainError(
  e: unknown
): e is RelationshipDomainError {
  return e instanceof RelationshipDomainError;
}
