export const AUTH_ERROR_CODES = [
  "INVALID_EMAIL",
  "CHALLENGE_NOT_FOUND",
  "CHALLENGE_EXPIRED",
  "CHALLENGE_CONSUMED",
  "INVALID_CODE",
  "CHALLENGE_LOCKED",
  "SESSION_NOT_FOUND",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "AUTH_CONFIGURATION_ERROR",
  "DELIVERY_FAILED",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthDomainError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthDomainError";
    this.code = code;
  }
}

export function isAuthDomainError(e: unknown): e is AuthDomainError {
  return e instanceof AuthDomainError;
}
