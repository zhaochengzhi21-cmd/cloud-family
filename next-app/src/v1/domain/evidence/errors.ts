export const EVIDENCE_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "FAMILY_NOT_FOUND",
  "EVIDENCE_NOT_FOUND",
  "CLAIM_NOT_FOUND",
  "MEDIA_NOT_FOUND",
  "MEDIA_NOT_READABLE",
  "CROSS_FAMILY",
  "EVIDENCE_ALREADY_LINKED",
] as const;

export type EvidenceErrorCode = (typeof EVIDENCE_ERROR_CODES)[number];

export class EvidenceDomainError extends Error {
  readonly code: EvidenceErrorCode;

  constructor(code: EvidenceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "EvidenceDomainError";
    this.code = code;
  }
}

export function isEvidenceDomainError(e: unknown): e is EvidenceDomainError {
  return e instanceof EvidenceDomainError;
}
