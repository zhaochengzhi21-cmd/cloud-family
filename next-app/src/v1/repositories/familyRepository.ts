import { and, eq, isNull, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import {
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  users,
} from "@/db/schema";
import type { FamilyVisibility, MembershipRole } from "@/db/constants";
import type { FamilyIdentity } from "@/v1/domain/family/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

function mapFamily(row: typeof families.$inferSelect): FamilyIdentity {
  return {
    id: row.id,
    displayName: row.displayName,
    surname: row.surname,
    visibility: row.visibility as FamilyVisibility,
    discoveryEnabled: row.discoveryEnabled,
    createdByUserId: row.createdByUserId,
    currentVersionNo: row.currentVersionNo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findUserById(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function findActiveFamilyById(db: DbOrTx, familyId: string) {
  const [row] = await db
    .select()
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
    .limit(1);
  return row ? mapFamily(row) : null;
}

export async function findActiveMembership(
  db: DbOrTx,
  familyId: string,
  userId: string
) {
  const [row] = await db
    .select()
    .from(familyMemberships)
    .where(
      and(
        eq(familyMemberships.familyId, familyId),
        eq(familyMemberships.userId, userId),
        eq(familyMemberships.status, "ACTIVE")
      )
    )
    .limit(1);
  return row ?? null;
}

export async function insertFamily(
  db: DbOrTx,
  values: {
    id: string;
    displayName: string;
    surname: string | null;
    visibility: FamilyVisibility;
    discoveryEnabled: boolean;
    createdByUserId: string;
    currentVersionNo: number;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(families).values(values);
}

export async function insertMembership(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    userId: string;
    role: MembershipRole;
    status: "ACTIVE" | "SUSPENDED";
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(familyMemberships).values(values);
}

export async function insertFamilyVersion(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    versionNo: number;
    createdByUserId: string | null;
    schemaVersion: number;
    summary: string | null;
    createdAt: Date;
  }
) {
  await db.insert(familyVersions).values({
    ...values,
    contentHash: null,
    snapshotJson: null,
  });
}

export async function insertAuditEvent(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string | null;
    actorUserId: string | null;
    eventType: string;
    entityType: string | null;
    entityId: string | null;
    metadataJson: Record<string, unknown> | null;
    createdAt: Date;
  }
) {
  await db.insert(auditEvents).values(values);
}

/**
 * Conditional identity update — succeeds only when current_version_no matches.
 * Returns the new version number, or null if no row matched (stale / missing).
 */
export async function updateFamilyIdentityConditional(
  db: DbOrTx,
  args: {
    familyId: string;
    expectedVersion: number;
    displayName: string;
    surname: string | null;
    visibility: FamilyVisibility;
    discoveryEnabled: boolean;
    updatedAt: Date;
  }
): Promise<number | null> {
  const nextVersion = args.expectedVersion + 1;
  const updated = await db
    .update(families)
    .set({
      displayName: args.displayName,
      surname: args.surname,
      visibility: args.visibility,
      discoveryEnabled: args.discoveryEnabled,
      currentVersionNo: nextVersion,
      updatedAt: args.updatedAt,
    })
    .where(
      and(
        eq(families.id, args.familyId),
        eq(families.currentVersionNo, args.expectedVersion),
        isNull(families.deletedAt)
      )
    )
    .returning({ currentVersionNo: families.currentVersionNo });

  return updated[0]?.currentVersionNo ?? null;
}

/** Lock family row for concurrent-safe read-modify (SELECT … FOR UPDATE). */
export async function lockActiveFamilyRow(db: DbOrTx, familyId: string) {
  const result = await db.execute(sql`
    SELECT id, display_name, surname, visibility, discovery_enabled,
           created_by_user_id, current_version_no, created_at, updated_at
    FROM families
    WHERE id = ${familyId} AND deleted_at IS NULL
    FOR UPDATE
  `);
  const row = result.rows[0] as
    | {
        id: string;
        display_name: string;
        surname: string | null;
        visibility: string;
        discovery_enabled: boolean;
        created_by_user_id: string | null;
        current_version_no: number;
        created_at: Date;
        updated_at: Date;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    surname: row.surname,
    visibility: row.visibility as FamilyVisibility,
    discoveryEnabled: row.discovery_enabled,
    createdByUserId: row.created_by_user_id,
    currentVersionNo: Number(row.current_version_no),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  } satisfies FamilyIdentity;
}

export async function countFamilyVersions(db: DbOrTx, familyId: string) {
  const result = await db.execute(sql`
    SELECT count(*)::int AS c FROM family_versions WHERE family_id = ${familyId}
  `);
  return Number((result.rows[0] as { c: number }).c);
}

export async function countAuditEvents(
  db: DbOrTx,
  familyId: string,
  eventType?: string
) {
  if (eventType) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS c FROM audit_events
      WHERE family_id = ${familyId} AND event_type = ${eventType}
    `);
    return Number((result.rows[0] as { c: number }).c);
  }
  const result = await db.execute(sql`
    SELECT count(*)::int AS c FROM audit_events WHERE family_id = ${familyId}
  `);
  return Number((result.rows[0] as { c: number }).c);
}
