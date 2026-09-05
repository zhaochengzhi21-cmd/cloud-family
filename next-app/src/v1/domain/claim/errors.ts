export const CLAIM_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "CLAIM_NOT_FOUND",
  "SUBJECT_NOT_FOUND",
  "SUBJECT_NOT_READABLE",
  "DUPLICATE_ACTIVE_CLAIM",
  "INVALID_CLAIM_STATUS_TRANSITION",
  "REVIEW_CONFLICT",
  "CROSS_FAMILY",
  "SELF_ASSERTION",
  "RELATIONSHIP_NOT_ACCEPTED",
] as const;

export type ClaimErrorCode = (typeof CLAIM_ERROR_CODES)[number];

export class ClaimDomainError extends Error {
  readonly code: ClaimErrorCode;

  constructor(code: ClaimErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ClaimDomainError";
    this.code = code;
  }
}

export function isClaimDomainError(e: unknown): e is ClaimDomainError {
  return e instanceof ClaimDomainError;
}
