/**
 * Trusted internal Evidence data access — not a public security boundary.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import { claimEvidence, evidence } from "@/db/schema";
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
