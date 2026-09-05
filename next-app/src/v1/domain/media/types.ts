import type { MediaStatus, MediaVisibility } from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type MediaView = {
  id: string;
  familyId: string;
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
  familyVersion: number;
  physicalDeleted: boolean;
};

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
