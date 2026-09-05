/**
 * Trusted internal Person data access — not a public security boundary.
 * Callers (services) must authorize via PermissionService.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { persons } from "@/db/schema";
import type {
  LivingStatus,
  PersonGender,
  PrivacyLevel,
} from "@/db/constants";
import type { PersonView } from "@/v1/domain/person/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export function mapPerson(row: typeof persons.$inferSelect): PersonView {
  return {
    id: row.id,
    familyId: row.familyId,
    preferredName: row.preferredName,
    gender: row.gender as PersonGender,
    livingStatus: row.livingStatus as LivingStatus,
    privacyLevel: row.privacyLevel as PrivacyLevel,
    revisionNo: row.revisionNo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Includes soft-deleted rows (for internal checks). */
export async function findPersonById(db: DbOrTx, personId: string) {
  const [row] = await db
    .select()
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return row ?? null;
}

export async function findActivePersonById(db: DbOrTx, personId: string) {
  const [row] = await db
    .select()
    .from(persons)
    .where(and(eq(persons.id, personId), isNull(persons.deletedAt)))
    .limit(1);
  return row ? mapPerson(row) : null;
}

export async function listActivePersonsByFamily(
  db: DbOrTx,
  familyId: string
): Promise<PersonView[]> {
  const rows = await db
    .select()
    .from(persons)
    .where(and(eq(persons.familyId, familyId), isNull(persons.deletedAt)));
  return rows.map(mapPerson);
}

export async function insertPerson(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    preferredName: string;
    gender: PersonGender;
    livingStatus: LivingStatus;
    privacyLevel: PrivacyLevel;
    revisionNo: number;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(persons).values({
    ...values,
    deletedAt: null,
  });
}

/**
 * Optimistic update — succeeds only when revision_no matches.
 * Returns new revision or null on conflict / missing.
 */
export async function updatePersonConditional(
  db: DbOrTx,
  args: {
    personId: string;
    expectedRevision: number;
    preferredName: string;
    gender: PersonGender;
    livingStatus: LivingStatus;
    privacyLevel: PrivacyLevel;
    updatedAt: Date;
  }
): Promise<number | null> {
  const next = args.expectedRevision + 1;
  const updated = await db
    .update(persons)
    .set({
      preferredName: args.preferredName,
      gender: args.gender,
      livingStatus: args.livingStatus,
      privacyLevel: args.privacyLevel,
      revisionNo: next,
      updatedAt: args.updatedAt,
    })
    .where(
      and(
        eq(persons.id, args.personId),
        eq(persons.revisionNo, args.expectedRevision),
        isNull(persons.deletedAt)
      )
    )
    .returning({ revisionNo: persons.revisionNo });
  return updated[0]?.revisionNo ?? null;
}

export async function softDeletePerson(
  db: DbOrTx,
  personId: string,
  deletedAt: Date
): Promise<boolean> {
  const updated = await db
    .update(persons)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(and(eq(persons.id, personId), isNull(persons.deletedAt)))
    .returning({ id: persons.id });
  return updated.length > 0;
}

/** Lock person row FOR UPDATE (must be in transaction). */
export async function lockActivePersonRow(db: DbOrTx, personId: string) {
  const result = await db.execute(sql`
    SELECT id, family_id, preferred_name, gender, living_status, privacy_level,
           revision_no, created_by_user_id, created_at, updated_at
    FROM persons
    WHERE id = ${personId} AND deleted_at IS NULL
    FOR UPDATE
  `);
  const row = result.rows[0] as
    | {
        id: string;
        family_id: string;
        preferred_name: string;
        gender: string;
        living_status: string;
        privacy_level: string;
        revision_no: number;
        created_by_user_id: string | null;
        created_at: Date;
        updated_at: Date;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    preferredName: row.preferred_name,
    gender: row.gender as PersonGender,
    livingStatus: row.living_status as LivingStatus,
    privacyLevel: row.privacy_level as PrivacyLevel,
    revisionNo: Number(row.revision_no),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  } satisfies PersonView;
}
