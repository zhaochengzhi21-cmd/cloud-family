export const PERSON_ERROR_CODES = [
  "INVALID_INPUT",
  "PERSON_NOT_FOUND",
  "FAMILY_NOT_FOUND",
  "FORBIDDEN",
  "PERSON_VERSION_CONFLICT",
  "PERSON_DELETED",
] as const;

export type PersonErrorCode = (typeof PERSON_ERROR_CODES)[number];

export class PersonDomainError extends Error {
  readonly code: PersonErrorCode;

  constructor(code: PersonErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PersonDomainError";
    this.code = code;
  }
}

export function isPersonDomainError(e: unknown): e is PersonDomainError {
  return e instanceof PersonDomainError;
}
