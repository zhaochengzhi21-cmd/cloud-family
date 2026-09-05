export const PERMISSION_ERROR_CODES = [
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "PERSON_NOT_FOUND",
  "MEDIA_NOT_FOUND",
  "SHARE_LINK_NOT_FOUND",
  "SHARE_LINK_REVOKED",
  "SHARE_LINK_EXPIRED",
  "INVALID_INPUT",
] as const;

export type PermissionErrorCode = (typeof PERMISSION_ERROR_CODES)[number];

export class PermissionDomainError extends Error {
  readonly code: PermissionErrorCode;

  constructor(code: PermissionErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PermissionDomainError";
    this.code = code;
  }
}

export function isPermissionDomainError(
  e: unknown
): e is PermissionDomainError {
  return e instanceof PermissionDomainError;
}
