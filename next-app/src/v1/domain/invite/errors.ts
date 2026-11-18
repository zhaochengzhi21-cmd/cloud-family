export const INVITE_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "INVITE_NOT_FOUND",
  "INVITE_UNAVAILABLE",
  "MEMBERSHIP_SUSPENDED",
] as const;

export type InviteErrorCode = (typeof INVITE_ERROR_CODES)[number];

export class InviteDomainError extends Error {
  readonly code: InviteErrorCode;

  constructor(code: InviteErrorCode, message?: string) {
    super(message ?? code);
    this.name = "InviteDomainError";
    this.code = code;
  }
}

export function isInviteDomainError(e: unknown): e is InviteDomainError {
  return e instanceof InviteDomainError;
}
