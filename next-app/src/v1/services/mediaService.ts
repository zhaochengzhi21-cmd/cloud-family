/**
 * Media Service — authorization boundary for private object media.
 * Callers never pass storageKey; signed URLs only after PermissionService.
 */

import { createHash, randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { MediaDomainError } from "@/v1/domain/media/errors";
import {
  assertUuid,
  validateUploadMediaInput,
} from "@/v1/domain/media/validation";
import {
  buildOpaqueStorageKey,
  mimeCategory,
  type DeleteMediaResult,
  type MediaReadAccess,
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

  // Authorize before pending row
  const auth = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "UPLOAD_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  // EDITOR may only upload FAMILY visibility
  if (auth.activeRole === "EDITOR") {
    if (validated.visibility !== "FAMILY") {
      throw new MediaDomainError("FORBIDDEN");
    }
  }

  // Insert PENDING (no Family Version yet)
  await mediaRepo.insertPendingMedia(database, {
    id: mediaId,
    familyId: validated.familyId,
    uploadedByUserId: userId,
    storageKey,
    originalFilename: validated.originalFilename,
    mimeType: validated.mimeType,
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

  // Verify object exists
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
    // Compensation: remove orphan object; keep non-ACTIVE
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
 * Authorized signed READ URL (TTL ≤ 60s). Never accepts caller storageKey.
 */
export async function getMediaReadAccess(
  mediaId: string,
  actorContext: AccessContext,
  options?: MediaServiceOptions
): Promise<MediaReadAccess> {
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();

  const auth = await authorizeMediaAction(
    mediaId,
    actorContext,
    "READ_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media || media.status !== "ACTIVE") {
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
 * Logical delete first (DELETION_PENDING + Family Version), then physical delete.
 */
export async function deleteMedia(
  mediaId: string,
  actorContext: AccessContext,
  options?: MediaServiceOptions
): Promise<DeleteMediaResult> {
  assertUuid(mediaId, "mediaId");
  const database = dbOrDefault(options?.db);
  const storage = options?.storage ?? getObjectStorage();
  const userId = actorUserId(actorContext);
  const now = new Date();

  const auth = await authorizeMediaAction(
    mediaId,
    actorContext,
    "DELETE_MEDIA",
    { db: database }
  ).catch(mapPerm);
  if (auth.decision !== "ALLOW") {
    throw new MediaDomainError("FORBIDDEN");
  }

  const media = await mediaRepo.findMediaById(database, mediaId);
  if (!media || media.status !== "ACTIVE") {
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
    // Remain DELETION_PENDING — read already DENY
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
