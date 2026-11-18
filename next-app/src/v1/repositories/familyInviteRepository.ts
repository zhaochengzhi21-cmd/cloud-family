/**
 * Trusted internal family-invite data access — services authorize.
 */

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { familyInvites } from "@/db/schema";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export async function insertInvite(
  db: DbOrTx,
  values: typeof familyInvites.$inferInsert
) {
  await db.insert(familyInvites).values(values);
}

/** Open = not consumed, not revoked, not expired. */
export async function listOpenInvites(
  db: DbOrTx,
  familyId: string,
  now: Date
) {
  return db
    .select({
      id: familyInvites.id,
      role: familyInvites.role,
      expiresAt: familyInvites.expiresAt,
      createdAt: familyInvites.createdAt,
    })
    .from(familyInvites)
    .where(
      and(
        eq(familyInvites.familyId, familyId),
        isNull(familyInvites.consumedAt),
        isNull(familyInvites.revokedAt),
        gt(familyInvites.expiresAt, now)
      )
    )
    .orderBy(desc(familyInvites.createdAt));
}

export async function findInviteById(db: DbOrTx, inviteId: string) {
  const [row] = await db
    .select()
    .from(familyInvites)
    .where(eq(familyInvites.id, inviteId))
    .limit(1);
  return row ?? null;
}

export async function findInviteByTokenHash(db: DbOrTx, tokenHash: string) {
  const [row] = await db
    .select()
    .from(familyInvites)
    .where(eq(familyInvites.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function lockInviteByTokenHash(db: Tx, tokenHash: string) {
  const result = await db.execute(sql`
    SELECT id FROM family_invites WHERE token_hash = ${tokenHash} FOR UPDATE
  `);
  const row = result.rows[0] as { id: string } | undefined;
  return row ? findInviteById(db, row.id) : null;
}

export async function revokeInvite(db: DbOrTx, inviteId: string, now: Date) {
  await db
    .update(familyInvites)
    .set({ revokedAt: now })
    .where(and(eq(familyInvites.id, inviteId), isNull(familyInvites.revokedAt)));
}

export async function markInviteConsumed(
  db: DbOrTx,
  inviteId: string,
  userId: string,
  now: Date
) {
  await db
    .update(familyInvites)
    .set({ consumedAt: now, consumedByUserId: userId })
    .where(eq(familyInvites.id, inviteId));
}

export function isInviteOpen(
  row: { consumedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date
): boolean {
  return (
    !row.consumedAt && !row.revokedAt && row.expiresAt.getTime() > now.getTime()
  );
}
