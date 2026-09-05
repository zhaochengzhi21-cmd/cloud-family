/**
 * Media Service — authorization boundary for private object media.
 * Callers never pass storageKey; signed URLs only after PermissionService.
 * Direct client upload: reserve → Blob client token → finalize callback.
 */

import { createHash, randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { MediaDomainError } from "@/v1/domain/media/errors";
import {
  assertUuid,
  validateReserveMediaUploadInput,
  validateUploadMediaInput,
} from "@/v1/domain/media/validation";
import {
  buildOpaqueStorageKey,
  MEDIA_CLIENT_TOKEN_TTL_MS,
  MEDIA_MULTIPART_THRESHOLD_BYTES,
  MEDIA_STALE_PENDING_MS,
  MEDIA_UPLOAD_INTENT_TTL_MS,
  mimeCategory,
  type DeleteMediaResult,
  type MediaReadAccess,
  type MediaStatusView,
  type ReserveMediaUploadInput,
  type ReserveMediaUploadResult,
  type UploadMediaInput,
  type UploadMediaResult,
} from "@/v1/domain/media/types";
import type { AccessContext } from "@/v1/domain/permission/types";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  authorizeFamilyAction,
  authorizeMediaAction,
} from "@/v1/services/permissionService";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";
import * as mediaRepo from "@/v1/repositories/mediaRepository";
import { getObjectStorage } from "@/v1/storage/objectStorage";
import type { ObjectStorage } from "@/v1/storage/types";
import { SIGNED_READ_URL_TTL_SECONDS } from "@/v1/storage/types";
import { isStorageError } from "@/v1/storage/errors";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function actorUserId(ctx: AccessContext): string | null {
  if (ctx.kind === "USER" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.userId;
  }
  return null;
}

function mapPerm(e: unknown): never {
  if (e instanceof PermissionDomainError) {
    if (e.code === "FAMILY_NOT_FOUND") {
      throw new MediaDomainError("FAMILY_NOT_FOUND");
    }
    if (e.code === "MEDIA_NOT_FOUND") {
      throw new MediaDomainError("MEDIA_NOT_FOUND");
    }
    throw new MediaDomainError("FORBIDDEN");
  }
  throw e;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type MediaServiceOptions = {
  db?: V1Db;
  storage?: ObjectStorage;
};

/**
 * Server-side upload foundation (not HTTP).
 * PENDING → put object → ACTIVE + Family Version once.
 */
export async function uploadMedia(
  input: UploadMediaInput,
  options?: MediaServiceOptions
): Promise<UploadMediaResult> {
  const validated = validateUploadMediaInput(input);
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();
  const now = new Date();
  const userId = actorUserId(input.actorContext);
  const mediaId = randomUUID();
  const storageKey = buildOpaqueStorageKey(validated.familyId, mediaId);

  const auth = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "UPLOAD_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  if (auth.activeRole === "EDITOR") {
    if (validated.visibility !== "FAMILY") {
      throw new MediaDomainError("FORBIDDEN");
    }
  }

  await mediaRepo.insertPendingMedia(database, {
    id: mediaId,
    familyId: validated.familyId,
    uploadedByUserId: userId,
    storageKey,
    originalFilename: validated.originalFilename,
    mimeType: validated.mimeType,
    byteSize: null,
    visibility: validated.visibility,
    createdAt: now,
  });

  const digest = sha256Hex(validated.body);

  try {
    await storage.putObject({
      key: storageKey,
      body: validated.body,
      contentType: validated.mimeType,
      contentLength: validated.body.length,
      cacheControl: "private, no-store",
    });
  } catch (e) {
    await mediaRepo.markMediaFailed(database, mediaId);
    throw new MediaDomainError(
      "UPLOAD_FAILED",
      isStorageError(e) ? e.code : "put failed"
    );
  }

  const head = await storage.headObject(storageKey);
  if (!head || head.contentLength !== validated.body.length) {
    try {
      await storage.deleteObject(storageKey);
    } catch {
      /* best-effort */
    }
    await mediaRepo.markMediaFailed(database, mediaId);
    throw new MediaDomainError("UPLOAD_FAILED", "head verification failed");
  }

  try {
    const familyVersion = await database.transaction(async (tx) => {
      const family = await lockFamilyForMutation(tx, validated.familyId);
      if (!family) {
        throw new MediaDomainError("FAMILY_NOT_FOUND");
      }

      const ok = await mediaRepo.activateMedia(tx, {
        mediaId,
        byteSize: validated.body.length,
        sha256: digest,
      });
      if (!ok) {
        throw new MediaDomainError("UPLOAD_FAILED", "activate failed");
      }

      return advanceFamilyVersion(tx, {
        familyId: validated.familyId,
        actorUserId: userId,
        summary: "MEDIA_CREATED",
        eventType: "MEDIA_CREATED",
        entityType: "MEDIA",
        entityId: mediaId,
        metadataJson: {
          mimeCategory: mimeCategory(validated.mimeType),
          byteSize: validated.body.length,
        },
        now: new Date(),
      });
    });

    return {
      mediaId,
      visibility: validated.visibility,
      mimeType: validated.mimeType,
      byteSize: validated.body.length,
      familyVersion,
    };
  } catch (e) {
    try {
      await storage.deleteObject(storageKey);
    } catch {
      /* best-effort */
    }
    await mediaRepo.markMediaFailed(database, mediaId);
    if (e instanceof MediaDomainError) throw e;
    throw new MediaDomainError("UPLOAD_FAILED", "finalize failed");
  }
}

/**
 * Reserve PENDING_UPLOAD for browser → Private Blob direct upload.
 * Does NOT advance Family Version or write MEDIA_CREATED.
 */
export async function reserveMediaUpload(
  input: ReserveMediaUploadInput,
  options?: MediaServiceOptions
): Promise<ReserveMediaUploadResult> {
  const validated = validateReserveMediaUploadInput(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const userId = actorUserId(input.actorContext);
  if (!userId) {
    throw new MediaDomainError("FORBIDDEN");
  }

  const auth = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "UPLOAD_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }
  if (auth.activeRole === "EDITOR" && validated.visibility !== "FAMILY") {
    throw new MediaDomainError("FORBIDDEN");
  }

  const mediaId = randomUUID();
  const storageKey = buildOpaqueStorageKey(validated.familyId, mediaId);

  await mediaRepo.insertPendingMedia(database, {
    id: mediaId,
    familyId: validated.familyId,
    uploadedByUserId: userId,
    storageKey,
    originalFilename: validated.originalFilename,
    mimeType: validated.mimeType,
    byteSize: validated.byteSize,
    visibility: validated.visibility,
    createdAt: now,
  });

  return {
    mediaId,
    status: "PENDING_UPLOAD",
    mimeType: validated.mimeType,
    byteSize: validated.byteSize,
    visibility: validated.visibility,
    pathname: storageKey,
  };
}

export type ClientUploadTokenConstraints = {
  mediaId: string;
  pathname: string;
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  validUntil: number;
  allowOverwrite: false;
  addRandomSuffix: false;
  tokenPayload: string;
};

/**
 * Re-authorize before issuing a Vercel Blob client upload token.
 * Throws MediaDomainError on any failure.
 */
export async function authorizeClientUploadToken(
  args: {
    mediaId: string;
    requestedPathname: string;
    actorContext: AccessContext;
    now?: Date;
  },
  options?: MediaServiceOptions
): Promise<ClientUploadTokenConstraints> {
  assertUuid(args.mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const now = args.now ?? new Date();
  const userId = actorUserId(args.actorContext);
  if (!userId) {
    throw new MediaDomainError("FORBIDDEN");
  }

  const media = await mediaRepo.findMediaById(database, args.mediaId);
  if (!media || media.deletedAt) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (media.status !== "PENDING_UPLOAD") {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (media.uploadedByUserId !== userId) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (args.requestedPathname !== media.storageKey) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (
    now.getTime() - media.createdAt.getTime() >
    MEDIA_UPLOAD_INTENT_TTL_MS
  ) {
    throw new MediaDomainError("INVALID_INPUT", "upload intent expired");
  }
  if (!media.mimeType || media.byteSize == null || media.byteSize <= 0) {
    throw new MediaDomainError("INVALID_INPUT", "incomplete reservation");
  }

  const auth = await authorizeFamilyAction(
    media.familyId,
    args.actorContext,
    "UPLOAD_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  return {
    mediaId: media.id,
    pathname: media.storageKey,
    allowedContentTypes: [media.mimeType],
    maximumSizeInBytes: media.byteSize,
    validUntil: now.getTime() + MEDIA_CLIENT_TOKEN_TTL_MS,
    allowOverwrite: false,
    addRandomSuffix: false,
    tokenPayload: JSON.stringify({ mediaId: media.id }),
  };
}

export type FinalizeClientUploadInput = {
  mediaId: string;
  pathname: string;
  contentType: string;
  /** Actual size from headObject (preferred) or provider metadata. */
  actualByteSize: number;
};

export type FinalizeClientUploadResult = {
  status: "ACTIVE" | "ALREADY_ACTIVE" | "FAILED";
  mediaId: string;
  familyVersion: number | null;
};

/**
 * Finalize after verified Vercel Blob onUploadCompleted.
 * Does not trust browser identity — facts from DB + provider metadata.
 * Idempotent: repeated success → ALREADY_ACTIVE, no extra version/audit.
 */
export async function finalizeClientUpload(
  input: FinalizeClientUploadInput,
  options?: MediaServiceOptions
): Promise<FinalizeClientUploadResult> {
  assertUuid(input.mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();

  const media = await mediaRepo.findMediaById(database, input.mediaId);
  if (!media) {
    try {
      await storage.deleteObject(input.pathname);
    } catch {
      /* best-effort */
    }
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }

  // Invalid terminal / mid states — never re-activate
  if (
    media.status === "FAILED" ||
    media.status === "DELETION_PENDING" ||
    media.status === "DELETED"
  ) {
    try {
      await storage.deleteObject(input.pathname);
    } catch {
      /* best-effort */
    }
    return { status: "FAILED", mediaId: media.id, familyVersion: null };
  }

  // Idempotent success path
  if (media.status === "ACTIVE") {
    if (
      media.storageKey === input.pathname &&
      media.byteSize === input.actualByteSize &&
      media.mimeType === input.contentType
    ) {
      return {
        status: "ALREADY_ACTIVE",
        mediaId: media.id,
        familyVersion: null,
      };
    }
    // Unexpected blob for already-active media
    try {
      if (input.pathname !== media.storageKey) {
        await storage.deleteObject(input.pathname);
      }
    } catch {
      /* best-effort */
    }
    return { status: "FAILED", mediaId: media.id, familyVersion: null };
  }

  if (media.status !== "PENDING_UPLOAD") {
    try {
      await storage.deleteObject(input.pathname);
    } catch {
      /* best-effort */
    }
    return { status: "FAILED", mediaId: media.id, familyVersion: null };
  }

  const failAndCleanup = async () => {
    try {
      await storage.deleteObject(input.pathname);
    } catch {
      /* best-effort */
    }
    if (input.pathname !== media.storageKey) {
      try {
        await storage.deleteObject(media.storageKey);
      } catch {
        /* best-effort */
      }
    }
    await mediaRepo.markMediaFailed(database, media.id);
    return {
      status: "FAILED" as const,
      mediaId: media.id,
      familyVersion: null,
    };
  };

  if (input.pathname !== media.storageKey) {
    return failAndCleanup();
  }
  if (!media.mimeType || media.byteSize == null) {
    return failAndCleanup();
  }
  if (input.contentType !== media.mimeType) {
    return failAndCleanup();
  }
  if (input.actualByteSize !== media.byteSize) {
    return failAndCleanup();
  }

  // Prefer live head check when storage available
  const head = await storage.headObject(media.storageKey);
  if (
    !head ||
    head.contentLength !== media.byteSize ||
    (head.contentType && head.contentType !== media.mimeType)
  ) {
    return failAndCleanup();
  }

  try {
    const familyVersion = await database.transaction(async (tx) => {
      const family = await lockFamilyForMutation(tx, media.familyId);
      if (!family) {
        throw new MediaDomainError("FAMILY_NOT_FOUND");
      }
      await mediaRepo.lockMediaRowForUpdate(tx, media.id);

      const ok = await mediaRepo.activateMedia(tx, {
        mediaId: media.id,
        byteSize: media.byteSize!,
        sha256: null, // Direct upload: server never saw full bytes
      });
      if (!ok) {
        // Concurrent winner already activated
        return null;
      }

      return advanceFamilyVersion(tx, {
        familyId: media.familyId,
        actorUserId: media.uploadedByUserId,
        summary: "MEDIA_CREATED",
        eventType: "MEDIA_CREATED",
        entityType: "MEDIA",
        entityId: media.id,
        metadataJson: {
          mimeCategory: mimeCategory(media.mimeType!),
          byteSize: media.byteSize,
          transport: "CLIENT_DIRECT_UPLOAD",
        },
        now: new Date(),
      });
    });

    if (familyVersion == null) {
      return {
        status: "ALREADY_ACTIVE",
        mediaId: media.id,
        familyVersion: null,
      };
    }

    return {
      status: "ACTIVE",
      mediaId: media.id,
      familyVersion,
    };
  } catch (e) {
    await failAndCleanup();
    if (e instanceof MediaDomainError) throw e;
    throw new MediaDomainError("UPLOAD_FAILED", "finalize failed");
  }
}

/**
 * Mark stale PENDING_UPLOAD as FAILED and delete orphan objects.
 * No Family Version / MEDIA_CREATED.
 */
export async function cleanupStalePendingMedia(
  options?: MediaServiceOptions & {
    olderThanMs?: number;
    limit?: number;
    now?: Date;
  }
): Promise<{ cleaned: number }> {
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();
  const now = options?.now ?? new Date();
  const olderThanMs = options?.olderThanMs ?? MEDIA_STALE_PENDING_MS;
  const cutoff = new Date(now.getTime() - olderThanMs);
  const stale = await mediaRepo.listStalePendingMedia(
    database,
    cutoff,
    options?.limit ?? 100
  );

  let cleaned = 0;
  for (const m of stale) {
    try {
      await storage.deleteObject(m.storageKey);
    } catch {
      /* best-effort */
    }
    await mediaRepo.markMediaFailed(database, m.id);
    cleaned += 1;
  }
  return { cleaned };
}

/**
 * Status for uploader / editors with UPLOAD_MEDIA (poll after client upload).
 */
export async function getMediaUploadStatus(
  familyId: string,
  mediaId: string,
  actorContext: AccessContext,
  options?: MediaServiceOptions
): Promise<MediaStatusView> {
  assertUuid(familyId, "familyId");
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);

  const auth = await authorizeFamilyAction(
    familyId,
    actorContext,
    "UPLOAD_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media || media.familyId !== familyId) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }

  const base: MediaStatusView = {
    mediaId: media.id,
    status: media.status,
  };
  if (media.status === "ACTIVE") {
    base.mimeType = media.mimeType;
    base.byteSize = media.byteSize;
    base.visibility = media.visibility;
  }
  return base;
}

/**
 * Authorized signed READ URL (TTL ≤ 60s). Never accepts caller storageKey.
 */
export async function getMediaReadAccess(
  mediaId: string,
  actorContext: AccessContext,
  options?: MediaServiceOptions & { expectedFamilyId?: string }
): Promise<MediaReadAccess> {
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (
    options?.expectedFamilyId &&
    media.familyId !== options.expectedFamilyId
  ) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }

  const auth = await authorizeMediaAction(
    mediaId,
    actorContext,
    "READ_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  if (media.status !== "ACTIVE") {
    throw new MediaDomainError("MEDIA_NOT_ACTIVE");
  }

  const signed = await storage.getSignedReadUrl(
    media.storageKey,
    SIGNED_READ_URL_TTL_SECONDS
  );

  return {
    mediaId: media.id,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    visibility: media.visibility,
    signedUrl: signed.url,
    expiresAt: signed.expiresAt,
  };
}

/**
 * Delete ACTIVE (version + audit) or cancel PENDING_UPLOAD (no version).
 */
export async function deleteMedia(
  mediaId: string,
  actorContext: AccessContext,
  options?: MediaServiceOptions & { expectedFamilyId?: string }
): Promise<DeleteMediaResult> {
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();
  const userId = actorUserId(actorContext);
  const now = new Date();

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }
  if (
    options?.expectedFamilyId &&
    media.familyId !== options.expectedFamilyId
  ) {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }

  // PENDING cancel: OWNER/ADMIN via DELETE_MEDIA (or uploader with UPLOAD?)
  // Spec: Owner/Admin may cancel PENDING. Use DELETE_MEDIA.
  if (media.status === "PENDING_UPLOAD") {
    const delAuth = await authorizeMediaAction(
      mediaId,
      actorContext,
      "DELETE_MEDIA",
      { db: database }
    ).catch(mapPerm);
    if (delAuth.decision !== "ALLOW") {
      throw new MediaDomainError("FORBIDDEN");
    }

    const cancelled = await mediaRepo.cancelPendingMedia(
      database,
      mediaId,
      now
    );
    if (!cancelled) {
      throw new MediaDomainError("MEDIA_NOT_FOUND");
    }
    let physicalDeleted = false;
    try {
      await storage.deleteObject(media.storageKey);
      physicalDeleted = true;
    } catch {
      physicalDeleted = false;
    }
    return {
      mediaId,
      status: "FAILED",
      familyVersion: null,
      physicalDeleted,
    };
  }

  const auth = await authorizeMediaAction(
    mediaId,
    actorContext,
    "DELETE_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  if (media.status !== "ACTIVE") {
    throw new MediaDomainError("MEDIA_NOT_FOUND");
  }

  const familyVersion = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, media.familyId);
    if (!family) throw new MediaDomainError("FAMILY_NOT_FOUND");

    const ok = await mediaRepo.markDeletionPending(tx, mediaId, now);
    if (!ok) throw new MediaDomainError("MEDIA_NOT_FOUND");

    return advanceFamilyVersion(tx, {
      familyId: media.familyId,
      actorUserId: userId,
      summary: "MEDIA_DELETED",
      eventType: "MEDIA_DELETED",
      entityType: "MEDIA",
      entityId: mediaId,
      metadataJson: {
        mimeCategory: media.mimeType
          ? mimeCategory(media.mimeType)
          : "other",
        byteSize: media.byteSize,
      },
      now,
    });
  });

  let physicalDeleted = false;
  try {
    await storage.deleteObject(media.storageKey);
    await mediaRepo.markMediaDeleted(database, mediaId);
    physicalDeleted = true;
  } catch {
    physicalDeleted = false;
  }

  return {
    mediaId,
    status: physicalDeleted ? "DELETED" : "DELETION_PENDING",
    familyVersion,
    physicalDeleted,
  };
}

/**
 * Retry physical deletion for DELETION_PENDING media.
 * Does not advance Family Version again.
 */
export async function retryPendingMediaDeletion(
  mediaId: string,
  options?: MediaServiceOptions
): Promise<{ status: "DELETED" | "DELETION_PENDING" }> {
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media) throw new MediaDomainError("MEDIA_NOT_FOUND");
  if (media.status === "DELETED") return { status: "DELETED" };
  if (media.status !== "DELETION_PENDING") {
    throw new MediaDomainError("INVALID_INPUT", "not pending deletion");
  }

  try {
    await storage.deleteObject(media.storageKey);
    await mediaRepo.markMediaDeleted(database, mediaId);
    return { status: "DELETED" };
  } catch {
    return { status: "DELETION_PENDING" };
  }
}

export function multipartRecommendedForSize(byteSize: number): boolean {
  return byteSize > MEDIA_MULTIPART_THRESHOLD_BYTES;
}
