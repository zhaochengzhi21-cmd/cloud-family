import type { MediaStatus, MediaVisibility } from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type MediaView = {
  id: string;
  familyId: string;
  uploadedByUserId: string | null;
  storageProvider: "PRIVATE_OBJECT";
  storageKey: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  visibility: MediaVisibility;
  status: MediaStatus;
  createdAt: Date;
  deletedAt: Date | null;
};

export type UploadMediaInput = {
  familyId: string;
  actorContext: AccessContext;
  body: Buffer;
  mimeType: string;
  originalFilename?: string | null;
  visibility?: MediaVisibility;
};

export type UploadMediaResult = {
  mediaId: string;
  visibility: MediaVisibility;
  mimeType: string;
  byteSize: number;
  familyVersion: number;
};

export type ReserveMediaUploadInput = {
  familyId: string;
  actorContext: AccessContext;
  mimeType: string;
  byteSize: number;
  originalFilename?: string | null;
  visibility?: MediaVisibility;
};

export type ReserveMediaUploadResult = {
  mediaId: string;
  status: "PENDING_UPLOAD";
  mimeType: string;
  byteSize: number;
  visibility: MediaVisibility;
  pathname: string;
};

export type MediaStatusView = {
  mediaId: string;
  status: MediaStatus;
  mimeType?: string | null;
  byteSize?: number | null;
  visibility?: MediaVisibility;
};

export type MediaReadAccess = {
  mediaId: string;
  mimeType: string | null;
  byteSize: number | null;
  visibility: MediaVisibility;
  signedUrl: string;
  expiresAt: Date;
};

export type DeleteMediaResult = {
  mediaId: string;
  status: MediaStatus;
  familyVersion: number | null;
  physicalDeleted: boolean;
};

/** PENDING upload intent TTL (token issuance window). */
export const MEDIA_UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;
/** Client upload token TTL. */
export const MEDIA_CLIENT_TOKEN_TTL_MS = 5 * 60 * 1000;
/** Abandoned PENDING cleanup age. */
export const MEDIA_STALE_PENDING_MS = 60 * 60 * 1000;
/** Client multipart recommendation threshold. */
export const MEDIA_MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

export const ALLOWED_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "video/mp4",
  "video/quicktime",
] as const;

export type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export const MEDIA_MAX_BYTES: Record<string, number> = {
  "image/jpeg": 20 * 1024 * 1024,
  "image/png": 20 * 1024 * 1024,
  "image/webp": 20 * 1024 * 1024,
  "application/pdf": 50 * 1024 * 1024,
  "audio/mpeg": 100 * 1024 * 1024,
  "audio/mp4": 100 * 1024 * 1024,
  "audio/wav": 100 * 1024 * 1024,
  "video/mp4": 250 * 1024 * 1024,
  "video/quicktime": 250 * 1024 * 1024,
};

export const DANGEROUS_MEDIA_MIME_TYPES = [
  "text/html",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/xml",
  "text/xml",
] as const;

export function buildOpaqueStorageKey(
  familyId: string,
  mediaId: string
): string {
  return `families/${familyId}/media/${mediaId}/original`;
}

export function mimeCategory(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}
