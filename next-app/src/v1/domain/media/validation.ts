import {
  MEDIA_VISIBILITY,
  type MediaVisibility,
} from "@/db/constants";
import { MediaDomainError } from "./errors";
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MEDIA_MAX_BYTES,
  type UploadMediaInput,
} from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new MediaDomainError("INVALID_INPUT", `${field} must be a UUID`);
  }
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function validateOriginalFilename(
  raw: string | null | undefined
): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new MediaDomainError("INVALID_INPUT", "originalFilename invalid");
  }
  const name = raw.trim();
  if (!name) return null;
  if (name.length > 255) {
    throw new MediaDomainError(
      "INVALID_INPUT",
      "originalFilename max 255 chars"
    );
  }
  if (hasControlChars(name)) {
    throw new MediaDomainError(
      "INVALID_INPUT",
      "originalFilename must not contain control characters"
    );
  }
  return name;
}

export type ValidatedUpload = {
  familyId: string;
  body: Buffer;
  mimeType: string;
  originalFilename: string | null;
  visibility: MediaVisibility;
};

export function validateUploadMediaInput(
  input: UploadMediaInput
): ValidatedUpload {
  assertUuid(input.familyId, "familyId");
  if (!Buffer.isBuffer(input.body) || input.body.length === 0) {
    throw new MediaDomainError("INVALID_INPUT", "body required");
  }
  if (
    !(ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(input.mimeType)
  ) {
    throw new MediaDomainError("INVALID_INPUT", "mimeType not allowed");
  }
  const max = MEDIA_MAX_BYTES[input.mimeType] ?? 0;
  if (input.body.length > max) {
    throw new MediaDomainError("INVALID_INPUT", "body exceeds size limit");
  }
  let visibility: MediaVisibility = "FAMILY";
  if (input.visibility !== undefined) {
    if (!(MEDIA_VISIBILITY as readonly string[]).includes(input.visibility)) {
      throw new MediaDomainError("INVALID_INPUT", "invalid visibility");
    }
    visibility = input.visibility;
  }
  return {
    familyId: input.familyId,
    body: input.body,
    mimeType: input.mimeType,
    originalFilename: validateOriginalFilename(input.originalFilename),
    visibility,
  };
}
