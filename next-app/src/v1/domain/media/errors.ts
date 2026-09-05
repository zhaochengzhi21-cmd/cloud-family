export const MEDIA_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "MEDIA_NOT_FOUND",
  "MEDIA_NOT_ACTIVE",
  "UPLOAD_FAILED",
  "STORAGE_ERROR",
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export class MediaDomainError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message?: string) {
    super(message ?? code);
    this.name = "MediaDomainError";
    this.code = code;
  }
}

export function isMediaDomainError(e: unknown): e is MediaDomainError {
  return e instanceof MediaDomainError;
}
