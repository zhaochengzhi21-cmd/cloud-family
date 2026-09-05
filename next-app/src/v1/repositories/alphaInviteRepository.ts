/**
 * Alpha invite repository — trusted internal access.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { alphaInvites } from "@/db/schema";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export async function insertAlphaInvite(
  db: DbOrTx,
  values: {
    id: string;
    tokenHash: string;
    emailLookupHash: string;
    expiresAt: Date;
    createdAt: Date;
  }
) {
  await db.insert(alphaInvites).values({
    ...values,
    consumedAt: null,
    revokedAt: null,
  });
}

export async function findInviteByTokenHash(db: DbOrTx, tokenHash: string) {
  const [row] = await db
    .select()
    .from(alphaInvites)
    .where(eq(alphaInvites.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function findInviteById(db: DbOrTx, id: string) {
  const [row] = await db
    .select()
    .from(alphaInvites)
    .where(eq(alphaInvites.id, id))
    .limit(1);
  return row ?? null;
}

/** Valid = not revoked, not consumed, not expired. */
export function isInviteCurrentlyValid(
  row: {
    revokedAt: Date | null;
    consumedAt: Date | null;
    expiresAt: Date;
  },
  now: Date
): boolean {
  if (row.revokedAt) return false;
  if (row.consumedAt) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Atomically consume invite. Returns true if this caller won.
 */
export async function tryConsumeInvite(
  db: DbOrTx,
  inviteId: string,
  now: Date
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE alpha_invites
    SET consumed_at = ${now}
    WHERE id = ${inviteId}
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > ${now}
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}

export async function revokeInvite(
  db: DbOrTx,
  inviteId: string,
  revokedAt: Date
): Promise<boolean> {
  const updated = await db
    .update(alphaInvites)
    .set({ revokedAt })
    .where(
      and(
        eq(alphaInvites.id, inviteId),
        isNull(alphaInvites.revokedAt),
        isNull(alphaInvites.consumedAt)
      )
    )
    .returning({ id: alphaInvites.id });
  return !!updated[0];
}
