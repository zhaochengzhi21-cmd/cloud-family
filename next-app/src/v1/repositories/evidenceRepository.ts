/**
 * Trusted internal Evidence data access — not a public security boundary.
 */

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { claimEvidence, evidence, mediaObjects } from "@/db/schema";
import type {
  ClaimEvidenceRelation,
  EvidenceType,
  EvidenceVisibility,
} from "@/db/constants";
import type { EvidenceDto } from "@/v1/domain/evidence/types";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export function mapEvidenceDto(row: typeof evidence.$inferSelect): EvidenceDto {
  return {
    id: row.id,
    familyId: row.familyId,
    evidenceType: row.evidenceType as EvidenceType,
    title: row.title,
    description: row.description,
    sourceLocator: row.sourceLocator,
    sourceDateText: row.sourceDateText,
    visibility: row.visibility as EvidenceVisibility,
    mediaObjectId: row.mediaObjectId,
    createdAt: row.createdAt,
  };
}

export async function findActiveEvidenceById(db: DbOrTx, evidenceId: string) {
  const [row] = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.id, evidenceId), isNull(evidence.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Includes soft-deleted rows (for restore). */
export async function findEvidenceRowById(db: DbOrTx, evidenceId: string) {
  const [row] = await db
    .select()
    .from(evidence)
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  return row ?? null;
}

export async function restoreEvidence(
  db: DbOrTx,
  evidenceId: string,
  now: Date
): Promise<boolean> {
  const [row] = await db
    .update(evidence)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(eq(evidence.id, evidenceId), isNotNull(evidence.deletedAt))
    )
    .returning({ id: evidence.id });
  return !!row;
}

export async function insertEvidence(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    evidenceType: EvidenceType;
    title: string | null;
    description: string | null;
    mediaObjectId: string | null;
    sourceLocator: string | null;
    sourceDateText: string | null;
    visibility: EvidenceVisibility;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  await db.insert(evidence).values({
    ...values,
    deletedAt: null,
  });
}

export async function softDeleteEvidence(
  db: DbOrTx,
  evidenceId: string,
  deletedAt: Date
): Promise<boolean> {
  const [row] = await db
    .update(evidence)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(and(eq(evidence.id, evidenceId), isNull(evidence.deletedAt)))
    .returning({ id: evidence.id });
  return !!row;
}

export async function findClaimEvidenceLink(
  db: DbOrTx,
  claimId: string,
  evidenceId: string
) {
  const [row] = await db
    .select()
    .from(claimEvidence)
    .where(
      and(
        eq(claimEvidence.claimId, claimId),
        eq(claimEvidence.evidenceId, evidenceId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function insertClaimEvidenceLink(
  db: DbOrTx,
  values: {
    claimId: string;
    evidenceId: string;
    relation: ClaimEvidenceRelation;
    createdByUserId: string | null;
    createdAt: Date;
  }
) {
  await db.insert(claimEvidence).values(values);
}

export async function deleteClaimEvidenceLink(
  db: DbOrTx,
  claimId: string,
  evidenceId: string
): Promise<boolean> {
  const deleted = await db
    .delete(claimEvidence)
    .where(
      and(
        eq(claimEvidence.claimId, claimId),
        eq(claimEvidence.evidenceId, evidenceId)
      )
    )
    .returning({ claimId: claimEvidence.claimId });
  return deleted.length > 0;
}

export async function listActiveEvidenceForFamily(db: DbOrTx, familyId: string) {
  return db
    .select({
      evidence,
      mimeType: mediaObjects.mimeType,
      mediaStatus: mediaObjects.status,
    })
    .from(evidence)
    .leftJoin(mediaObjects, eq(evidence.mediaObjectId, mediaObjects.id))
    .where(and(eq(evidence.familyId, familyId), isNull(evidence.deletedAt)))
    .orderBy(desc(evidence.createdAt));
}

export async function listActiveLinksForClaim(db: DbOrTx, claimId: string) {
  const rows = await db
    .select({
      relation: claimEvidence.relation,
      evidence: evidence,
    })
    .from(claimEvidence)
    .innerJoin(evidence, eq(claimEvidence.evidenceId, evidence.id))
    .where(
      and(eq(claimEvidence.claimId, claimId), isNull(evidence.deletedAt))
    );
  return rows.map((r) => ({
    relation: r.relation as ClaimEvidenceRelation,
    evidence: r.evidence,
  }));
}

/** Claim ids that have at least one non-deleted evidence link. */
export async function listClaimIdsWithActiveEvidence(
  db: DbOrTx,
  claimIds: string[]
): Promise<Set<string>> {
  if (claimIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ claimId: claimEvidence.claimId })
    .from(claimEvidence)
    .innerJoin(evidence, eq(claimEvidence.evidenceId, evidence.id))
    .where(
      and(
        inArray(claimEvidence.claimId, claimIds),
        isNull(evidence.deletedAt)
      )
    );
  return new Set(rows.map((r) => r.claimId));
}

export async function listActiveLinksForEvidence(
  db: DbOrTx,
  evidenceId: string
) {
  return db
    .select({
      claimId: claimEvidence.claimId,
      relation: claimEvidence.relation,
    })
    .from(claimEvidence)
    .where(eq(claimEvidence.evidenceId, evidenceId));
}

export async function countActiveLinksForEvidence(
  db: DbOrTx,
  evidenceId: string
): Promise<number> {
  const links = await listActiveLinksForEvidence(db, evidenceId);
  return links.length;
}

/** Batch link counts for family evidence lists (avoids N+1). */
export async function countActiveLinksForEvidenceIds(
  db: DbOrTx,
  evidenceIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (evidenceIds.length === 0) return out;
  for (const id of evidenceIds) out.set(id, 0);
  const rows = await db
    .select({
      evidenceId: claimEvidence.evidenceId,
      n: count(),
    })
    .from(claimEvidence)
    .where(inArray(claimEvidence.evidenceId, evidenceIds))
    .groupBy(claimEvidence.evidenceId);
  for (const r of rows) {
    out.set(r.evidenceId, Number(r.n));
  }
  return out;
}
