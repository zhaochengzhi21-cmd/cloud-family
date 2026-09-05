export const STORAGE_ERROR_CODES = [
  "STORAGE_CONFIGURATION_ERROR",
  "OBJECT_NOT_FOUND",
  "OBJECT_PUT_FAILED",
  "OBJECT_DELETE_FAILED",
  "OBJECT_SIGN_FAILED",
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message?: string) {
    super(message ?? code);
    this.name = "StorageError";
    this.code = code;
  }
}

export function isStorageError(e: unknown): e is StorageError {
  return e instanceof StorageError;
}
