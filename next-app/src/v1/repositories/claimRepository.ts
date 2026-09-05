/**
 * Trusted internal Claim data access — not a public security boundary.
 * Never update value_json / normalized_json / value_fingerprint / claim_type / subject.
 */

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { claims } from "@/db/schema";
import type {
  ClaimOriginType,
  ClaimStatus,
  ClaimSubjectType,
  ClaimType,
} from "@/db/constants";
import type { ClaimDto, ClaimValue } from "@/v1/domain/claim/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export function mapClaimDto(row: typeof claims.$inferSelect): ClaimDto {
  return {
    id: row.id,
    familyId: row.familyId,
    subjectType: row.subjectType as ClaimSubjectType,
    subjectId: row.subjectId,
    claimType: row.claimType as ClaimType,
    value: row.valueJson as ClaimValue,
    status: row.status as ClaimStatus,
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    originType: row.originType as ClaimOriginType,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

export async function findActiveClaimById(db: DbOrTx, claimId: string) {
  const [row] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.id, claimId), isNull(claims.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function findActiveDuplicate(
  db: DbOrTx,
  args: {
    familyId: string;
    subjectType: string;
    subjectId: string;
    claimType: string;
    valueFingerprint: string;
  }
) {
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(
      and(
        eq(claims.familyId, args.familyId),
        eq(claims.subjectType, args.subjectType),
        eq(claims.subjectId, args.subjectId),
        eq(claims.claimType, args.claimType),
        eq(claims.valueFingerprint, args.valueFingerprint),
        isNull(claims.deletedAt),
        ne(claims.status, "REJECTED")
      )
    )
    .limit(1);
  return row ?? null;
}

export async function insertClaim(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    subjectType: ClaimSubjectType;
    subjectId: string;
    claimType: ClaimType;
    valueJson: ClaimValue;
    normalizedJson: ClaimValue;
    valueFingerprint: string;
    confidence: string | null;
    originType: ClaimOriginType;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(claims).values({
    ...values,
    status: "PROPOSED",
    reviewedByUserId: null,
    reviewedAt: null,
    deletedAt: null,
  });
}

/** Status-only update from PROPOSED → reviewed. Returns null if race lost. */
export async function tryReviewProposedClaim(
  db: DbOrTx,
  args: {
    claimId: string;
    nextStatus: "ACCEPTED" | "REJECTED";
    reviewedByUserId: string;
    reviewedAt: Date;
    updatedAt: Date;
  }
): Promise<typeof claims.$inferSelect | null> {
  const [row] = await db
    .update(claims)
    .set({
      status: args.nextStatus,
      reviewedByUserId: args.reviewedByUserId,
      reviewedAt: args.reviewedAt,
      updatedAt: args.updatedAt,
    })
    .where(
      and(
        eq(claims.id, args.claimId),
        eq(claims.status, "PROPOSED"),
        isNull(claims.deletedAt)
      )
    )
    .returning();
  return row ?? null;
}

/** Reject from ACCEPTED or CONFLICTED (post-accept overturn). */
export async function tryRejectReviewedClaim(
  db: DbOrTx,
  args: {
    claimId: string;
    reviewedByUserId: string;
    reviewedAt: Date;
    updatedAt: Date;
  }
): Promise<typeof claims.$inferSelect | null> {
  const [row] = await db
    .update(claims)
    .set({
      status: "REJECTED",
      reviewedByUserId: args.reviewedByUserId,
      reviewedAt: args.reviewedAt,
      updatedAt: args.updatedAt,
    })
    .where(
      and(
        eq(claims.id, args.claimId),
        inArray(claims.status, ["ACCEPTED", "CONFLICTED"]),
        isNull(claims.deletedAt)
      )
    )
    .returning();
  return row ?? null;
}

export async function listConflictCandidates(
  db: DbOrTx,
  args: {
    familyId: string;
    subjectType: string;
    subjectId: string;
    claimType: string;
  }
) {
  return db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.familyId, args.familyId),
        eq(claims.subjectType, args.subjectType),
        eq(claims.subjectId, args.subjectId),
        eq(claims.claimType, args.claimType),
        inArray(claims.status, ["ACCEPTED", "CONFLICTED"]),
        isNull(claims.deletedAt)
      )
    );
}

/** Set ACCEPTED or CONFLICTED only — never touches value fields. */
export async function setClaimConflictStatuses(
  db: DbOrTx,
  updates: Array<{ id: string; status: "ACCEPTED" | "CONFLICTED" }>,
  updatedAt: Date
): Promise<number> {
  let changed = 0;
  for (const u of updates) {
    const result = await db.execute(sql`
      UPDATE claims
      SET status = ${u.status},
          updated_at = ${updatedAt}
      WHERE id = ${u.id}
        AND deleted_at IS NULL
        AND status IN ('ACCEPTED', 'CONFLICTED')
        AND status IS DISTINCT FROM ${u.status}
    `);
    changed += Number(result.rowCount ?? 0);
  }
  return changed;
}

export async function listActiveClaimsForSubject(
  db: DbOrTx,
  args: {
    familyId: string;
    subjectType: string;
    subjectId: string;
  }
) {
  return db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.familyId, args.familyId),
        eq(claims.subjectType, args.subjectType),
        eq(claims.subjectId, args.subjectId),
        isNull(claims.deletedAt)
      )
    );
}
