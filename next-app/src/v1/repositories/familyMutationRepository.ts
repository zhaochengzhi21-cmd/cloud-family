/**
 * Shared Family Domain mutation primitives.
 * families.current_version_no is the global Family Domain revision.
 * Repository methods are trusted internal data access — callers must authorize.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/v1/repositories/familyRepository";
import {
  insertAuditEvent,
  insertFamilyVersion,
  lockActiveFamilyRow,
} from "@/v1/repositories/familyRepository";

export { lockActiveFamilyRow as lockFamilyForMutation };

/**
 * Atomically bump families.current_version_no (caller must hold family row lock).
 * Returns the new version number.
 */
export async function advanceFamilyVersionNumber(
  db: DbOrTx,
  familyId: string,
  now: Date
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE families
    SET current_version_no = current_version_no + 1,
        updated_at = ${now}
    WHERE id = ${familyId} AND deleted_at IS NULL
    RETURNING current_version_no
  `);
  const row = result.rows[0] as { current_version_no: number } | undefined;
  if (!row) {
    throw new Error("advanceFamilyVersionNumber: family missing or deleted");
  }
  return Number(row.current_version_no);
}

/**
 * Record family_versions + audit_events for a successful mutation.
 * Does not bump the counter — pair with advanceFamilyVersionNumber or
 * conditional identity update that already set the new version.
 */
export async function recordFamilyMutationLedger(
  db: DbOrTx,
  args: {
    familyId: string;
    versionNo: number;
    actorUserId: string | null;
    summary: string;
    eventType: string;
    entityType: string;
    entityId: string;
    metadataJson: Record<string, unknown>;
    now: Date;
  }
): Promise<void> {
  await insertFamilyVersion(db, {
    id: randomUUID(),
    familyId: args.familyId,
    versionNo: args.versionNo,
    createdByUserId: args.actorUserId,
    schemaVersion: 1,
    summary: args.summary,
    createdAt: args.now,
  });
  await insertAuditEvent(db, {
    id: randomUUID(),
    familyId: args.familyId,
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    entityType: args.entityType,
    entityId: args.entityId,
    metadataJson: args.metadataJson,
    createdAt: args.now,
  });
}

/**
 * Bump global family version + write version ledger + audit in one step.
 * Caller must already hold SELECT … FOR UPDATE on the family row.
 */
export async function advanceFamilyVersion(
  db: DbOrTx,
  args: {
    familyId: string;
    actorUserId: string | null;
    summary: string;
    eventType: string;
    entityType: string;
    entityId: string;
    metadataJson: Record<string, unknown>;
    now: Date;
  }
): Promise<number> {
  const versionNo = await advanceFamilyVersionNumber(
    db,
    args.familyId,
    args.now
  );
  await recordFamilyMutationLedger(db, {
    familyId: args.familyId,
    versionNo,
    actorUserId: args.actorUserId,
    summary: args.summary,
    eventType: args.eventType,
    entityType: args.entityType,
    entityId: args.entityId,
    metadataJson: {
      ...args.metadataJson,
      familyVersion: versionNo,
    },
    now: args.now,
  });
  return versionNo;
}
