export const FAMILY_ERROR_CODES = [
  "OWNER_USER_NOT_FOUND",
  "FAMILY_NOT_FOUND",
  "FORBIDDEN",
  "VERSION_CONFLICT",
  "INVALID_INPUT",
  "NO_CHANGES",
] as const;

export type FamilyErrorCode = (typeof FAMILY_ERROR_CODES)[number];

/** Domain-level error — never leak raw Postgres messages to callers. */
export class FamilyDomainError extends Error {
  readonly code: FamilyErrorCode;

  constructor(code: FamilyErrorCode, message?: string) {
    super(message ?? code);
    this.name = "FamilyDomainError";
    this.code = code;
  }
}

export function isFamilyDomainError(e: unknown): e is FamilyDomainError {
  return e instanceof FamilyDomainError;
}
