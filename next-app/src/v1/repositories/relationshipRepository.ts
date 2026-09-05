/**
 * Trusted internal Relationship data access — not a public security boundary.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { relationships } from "@/db/schema";
import type { RelationshipType } from "@/db/constants";
import type { RelationshipView } from "@/v1/domain/relationship/types";
import { PARENT_RELATIONSHIP_TYPES } from "@/v1/domain/relationship/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export function mapRelationship(
  row: typeof relationships.$inferSelect
): RelationshipView {
  return {
    id: row.id,
    familyId: row.familyId,
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    relationshipType: row.relationshipType as RelationshipType,
    status: "ACCEPTED",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertRelationship(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    fromPersonId: string;
    toPersonId: string;
    relationshipType: RelationshipType;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(relationships).values({
    ...values,
    status: "ACCEPTED",
    deletedAt: null,
  });
}

export async function findActiveRelationship(
  db: DbOrTx,
  familyId: string,
  fromPersonId: string,
  toPersonId: string,
  relationshipType: RelationshipType
) {
  const [row] = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.familyId, familyId),
        eq(relationships.fromPersonId, fromPersonId),
        eq(relationships.toPersonId, toPersonId),
        eq(relationships.relationshipType, relationshipType),
        isNull(relationships.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function findActiveRelationshipById(
  db: DbOrTx,
  relationshipId: string
) {
  const [row] = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.id, relationshipId),
        isNull(relationships.deletedAt)
      )
    )
    .limit(1);
  return row ? mapRelationship(row) : null;
}

export async function listActiveAcceptedByFamily(
  db: DbOrTx,
  familyId: string
): Promise<RelationshipView[]> {
  const rows = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.familyId, familyId),
        eq(relationships.status, "ACCEPTED"),
        isNull(relationships.deletedAt)
      )
    );
  return rows.map(mapRelationship);
}

/** Active accepted parent-like edges for cycle / generation. */
export async function listActiveParentEdges(
  db: DbOrTx,
  familyId: string
): Promise<Array<{ fromPersonId: string; toPersonId: string }>> {
  const rows = await db
    .select({
      fromPersonId: relationships.fromPersonId,
      toPersonId: relationships.toPersonId,
      relationshipType: relationships.relationshipType,
    })
    .from(relationships)
    .where(
      and(
        eq(relationships.familyId, familyId),
        eq(relationships.status, "ACCEPTED"),
        isNull(relationships.deletedAt),
        sql`${relationships.relationshipType} IN ('BIOLOGICAL_PARENT', 'ADOPTIVE_PARENT', 'STEP_PARENT')`
      )
    );
  return rows.map((r) => ({
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
  }));
}

export async function softDeleteRelationship(
  db: DbOrTx,
  relationshipId: string,
  deletedAt: Date
): Promise<boolean> {
  const updated = await db
    .update(relationships)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(relationships.id, relationshipId),
        isNull(relationships.deletedAt)
      )
    )
    .returning({ id: relationships.id });
  return updated.length > 0;
}

/** Soft-delete all active relationships involving a person. Returns count. */
export async function softDeleteRelationshipsForPerson(
  db: DbOrTx,
  familyId: string,
  personId: string,
  deletedAt: Date
): Promise<number> {
  const updated = await db
    .update(relationships)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(relationships.familyId, familyId),
        isNull(relationships.deletedAt),
        or(
          eq(relationships.fromPersonId, personId),
          eq(relationships.toPersonId, personId)
        )
      )
    )
    .returning({ id: relationships.id });
  return updated.length;
}

void PARENT_RELATIONSHIP_TYPES;
