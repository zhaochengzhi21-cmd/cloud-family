import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { authChallenges, sessions, users } from "@/db/schema";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export async function insertChallenge(
  db: DbOrTx,
  values: {
    id: string;
    emailLookupHash: string;
    emailCiphertext: Buffer;
    emailKeyVersion: number;
    codeDigest: string;
    expiresAt: Date;
    createdAt: Date;
    alphaInviteId?: string | null;
  }
) {
  await db.insert(authChallenges).values({
    id: values.id,
    emailLookupHash: values.emailLookupHash,
    emailCiphertext: values.emailCiphertext,
    emailKeyVersion: values.emailKeyVersion,
    codeDigest: values.codeDigest,
    expiresAt: values.expiresAt,
    createdAt: values.createdAt,
    alphaInviteId: values.alphaInviteId ?? null,
    failedAttempts: 0,
    consumedAt: null,
  });
}

export async function lockChallengeById(db: DbOrTx, challengeId: string) {
  const result = await db.execute(sql`
    SELECT id, email_lookup_hash, email_ciphertext, email_key_version,
           code_digest, failed_attempts, alpha_invite_id,
           expires_at, consumed_at, created_at
    FROM auth_challenges
    WHERE id = ${challengeId}
    FOR UPDATE
  `);
  const row = result.rows[0] as
    | {
        id: string;
        email_lookup_hash: string;
        email_ciphertext: Buffer;
        email_key_version: number;
        code_digest: string;
        failed_attempts: number;
        alpha_invite_id: string | null;
        expires_at: Date;
        consumed_at: Date | null;
        created_at: Date;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    emailLookupHash: row.email_lookup_hash,
    emailCiphertext: Buffer.from(row.email_ciphertext),
    emailKeyVersion: Number(row.email_key_version),
    codeDigest: row.code_digest,
    failedAttempts: Number(row.failed_attempts),
    alphaInviteId: row.alpha_invite_id,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export async function incrementChallengeAttempts(
  db: DbOrTx,
  challengeId: string
) {
  await db
    .update(authChallenges)
    .set({ failedAttempts: sql`${authChallenges.failedAttempts} + 1` })
    .where(eq(authChallenges.id, challengeId));
}

export async function markChallengeConsumed(
  db: DbOrTx,
  challengeId: string,
  consumedAt: Date
) {
  await db
    .update(authChallenges)
    .set({ consumedAt })
    .where(eq(authChallenges.id, challengeId));
}

/** Invalidate so it cannot be used for login (delivery failure path). */
export async function invalidateChallenge(
  db: DbOrTx,
  challengeId: string,
  now: Date
) {
  await db
    .update(authChallenges)
    .set({ consumedAt: now, expiresAt: now })
    .where(eq(authChallenges.id, challengeId));
}

/** Count challenges for throttle windows. */
export async function countChallengesSince(
  db: DbOrTx,
  emailLookupHash: string,
  since: Date
): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM auth_challenges
    WHERE email_lookup_hash = ${emailLookupHash}
      AND created_at >= ${since}
  `);
  const row = result.rows[0] as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

export async function findLatestChallengeCreatedAt(
  db: DbOrTx,
  emailLookupHash: string
): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT created_at
    FROM auth_challenges
    WHERE email_lookup_hash = ${emailLookupHash}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = result.rows[0] as { created_at: Date } | undefined;
  return row ? new Date(row.created_at) : null;
}

export async function findUserByLookupHash(db: DbOrTx, lookupHash: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.emailLookupHash, lookupHash))
    .limit(1);
  return row ?? null;
}

export async function insertUser(
  db: DbOrTx,
  values: {
    id: string;
    emailLookupHash: string;
    emailCiphertext: Buffer;
    emailKeyVersion: number;
    emailVerifiedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(users).values({
    ...values,
    deletedAt: null,
  });
}

export async function updateUserEmailCrypto(
  db: DbOrTx,
  userId: string,
  values: {
    emailCiphertext: Buffer;
    emailKeyVersion: number;
    emailVerifiedAt: Date;
    updatedAt: Date;
  }
) {
  await db.update(users).set(values).where(eq(users.id, userId));
}

export async function softDeleteUser(db: DbOrTx, userId: string, now: Date) {
  await db
    .update(users)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(users.id, userId));
}

export async function insertSession(
  db: DbOrTx,
  values: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }
) {
  await db.insert(sessions).values({
    ...values,
    revokedAt: null,
    lastSeenAt: null,
  });
}

export async function findSessionByTokenHash(db: DbOrTx, tokenHash: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function touchSession(
  db: DbOrTx,
  sessionId: string,
  lastSeenAt: Date
) {
  await db
    .update(sessions)
    .set({ lastSeenAt })
    .where(eq(sessions.id, sessionId));
}

export async function revokeSessionByTokenHash(
  db: DbOrTx,
  tokenHash: string,
  revokedAt: Date
) {
  const updated = await db
    .update(sessions)
    .set({ revokedAt })
    .where(
      and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt))
    )
    .returning({ id: sessions.id });
  return updated[0] ?? null;
}

export async function revokeAllUserSessions(
  db: DbOrTx,
  userId: string,
  revokedAt: Date
) {
  await db
    .update(sessions)
    .set({ revokedAt })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function deleteExpiredChallengesBefore(db: DbOrTx, before: Date) {
  await db
    .delete(authChallenges)
    .where(lt(authChallenges.expiresAt, before));
}

export async function deleteExpiredSessionsBefore(db: DbOrTx, before: Date) {
  await db.delete(sessions).where(lt(sessions.expiresAt, before));
}

export async function findUserById(db: DbOrTx, userId: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
