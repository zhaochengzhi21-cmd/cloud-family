/**
 * Trusted internal Media data access — not a public security boundary.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { mediaObjects } from "@/db/schema";
import type { MediaStatus, MediaVisibility } from "@/db/constants";
import type { MediaView } from "@/v1/domain/media/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export function mapMedia(row: typeof mediaObjects.$inferSelect): MediaView {
  return {
    id: row.id,
    familyId: row.familyId,
    uploadedByUserId: row.uploadedByUserId,
    storageProvider: "PRIVATE_OBJECT",
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    visibility: row.visibility as MediaVisibility,
    status: row.status as MediaStatus,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export async function findMediaById(db: DbOrTx, mediaId: string) {
  const [row] = await db
    .select()
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaId))
    .limit(1);
  return row ? mapMedia(row) : null;
}

export async function insertPendingMedia(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    uploadedByUserId: string | null;
    storageKey: string;
    originalFilename: string | null;
    mimeType: string;
    /** Reserved expected size for client direct upload; null for legacy server upload. */
    byteSize: number | null;
    visibility: MediaVisibility;
    createdAt: Date;
  }
) {
  await db.insert(mediaObjects).values({
    id: values.id,
    familyId: values.familyId,
    uploadedByUserId: values.uploadedByUserId,
    storageProvider: "PRIVATE_OBJECT",
    storageKey: values.storageKey,
    originalFilename: values.originalFilename,
    mimeType: values.mimeType,
    byteSize: values.byteSize,
    sha256: null,
    visibility: values.visibility,
    status: "PENDING_UPLOAD",
    createdAt: values.createdAt,
    deletedAt: null,
  });
}

export async function markMediaFailed(db: DbOrTx, mediaId: string) {
  await db
    .update(mediaObjects)
    .set({ status: "FAILED" })
    .where(eq(mediaObjects.id, mediaId));
}

/**
 * PENDING_UPLOAD → ACTIVE. Returns false if already activated / wrong state.
 * sha256 may be null for direct client uploads (server never saw bytes).
 */
export async function activateMedia(
  db: DbOrTx,
  args: {
    mediaId: string;
    byteSize: number;
    sha256: string | null;
  }
): Promise<boolean> {
  const updated = await db
    .update(mediaObjects)
    .set({
      status: "ACTIVE",
      byteSize: args.byteSize,
      sha256: args.sha256,
    })
    .where(
      and(
        eq(mediaObjects.id, args.mediaId),
        eq(mediaObjects.status, "PENDING_UPLOAD")
      )
    )
    .returning({ id: mediaObjects.id });
  return updated.length > 0;
}

export async function markDeletionPending(
  db: DbOrTx,
  mediaId: string,
  deletedAt: Date
): Promise<boolean> {
  const updated = await db
    .update(mediaObjects)
    .set({
      status: "DELETION_PENDING",
      deletedAt,
    })
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        eq(mediaObjects.status, "ACTIVE"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .returning({ id: mediaObjects.id });
  return updated.length > 0;
}

export async function markMediaDeleted(db: DbOrTx, mediaId: string) {
  await db
    .update(mediaObjects)
    .set({ status: "DELETED" })
    .where(eq(mediaObjects.id, mediaId));
}

/** Cancel PENDING_UPLOAD without Family Version (never became ACTIVE). */
export async function cancelPendingMedia(
  db: DbOrTx,
  mediaId: string,
  now: Date
): Promise<boolean> {
  const updated = await db
    .update(mediaObjects)
    .set({
      status: "FAILED",
      deletedAt: now,
    })
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        eq(mediaObjects.status, "PENDING_UPLOAD")
      )
    )
    .returning({ id: mediaObjects.id });
  return updated.length > 0;
}

export async function listStalePendingMedia(
  db: DbOrTx,
  olderThan: Date,
  limit = 100
) {
  const rows = await db
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.status, "PENDING_UPLOAD"),
        lt(mediaObjects.createdAt, olderThan)
      )
    )
    .limit(limit);
  return rows.map(mapMedia);
}

export async function lockMediaRowForUpdate(db: Tx, mediaId: string) {
  const result = await db.execute(sql`
    SELECT id, family_id, uploaded_by_user_id, storage_provider, storage_key,
           original_filename, mime_type, byte_size, sha256, visibility, status,
           created_at, deleted_at
    FROM media_objects
    WHERE id = ${mediaId}
    FOR UPDATE
  `);
  const row = result.rows[0] as
    | {
        id: string;
        family_id: string;
        uploaded_by_user_id: string | null;
        storage_provider: string;
        storage_key: string;
        original_filename: string | null;
        mime_type: string | null;
        byte_size: number | null;
        sha256: string | null;
        visibility: string;
        status: string;
        created_at: Date;
        deleted_at: Date | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    uploadedByUserId: row.uploaded_by_user_id,
    storageProvider: "PRIVATE_OBJECT" as const,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
    sha256: row.sha256,
    visibility: row.visibility as MediaVisibility,
    status: row.status as MediaStatus,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
