/**
 * Trusted internal Media data access — not a public security boundary.
 */

import { and, eq, isNull } from "drizzle-orm";
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
    byteSize: null,
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

export async function activateMedia(
  db: DbOrTx,
  args: {
    mediaId: string;
    byteSize: number;
    sha256: string;
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
