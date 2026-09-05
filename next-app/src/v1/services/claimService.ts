/**
 * Claim Service — facts as proposals; values immutable; Conflict Engine owns CONFLICTED.
 * No updateClaimValue. Accept does not mutate Relationship graph.
 */

import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import type { ClaimStatus, ClaimSubjectType, ClaimType } from "@/db/constants";
import { ClaimDomainError } from "@/v1/domain/claim/errors";
import { getClaimTypeDefinition } from "@/v1/domain/claim/registry";
import { computeValueFingerprint } from "@/v1/domain/claim/normalization";
import { validateCreateClaimInput } from "@/v1/domain/claim/validation";
import type {
  ClaimBundle,
  ClaimDto,
  ClaimValue,
  CreateClaimInput,
  CreateClaimResult,
  RelationshipAssertionValue,
  ReviewClaimResult,
} from "@/v1/domain/claim/types";
import type { AccessContext } from "@/v1/domain/permission/types";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  authorizeFamilyAction,
  authorizeFamilyRead,
  authorizePersonRead,
} from "@/v1/services/permissionService";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";
import * as claimRepo from "@/v1/repositories/claimRepository";
import * as evidenceRepo from "@/v1/repositories/evidenceRepository";
import * as personRepo from "@/v1/repositories/personRepository";
import * as relRepo from "@/v1/repositories/relationshipRepository";
import { mapEvidenceDto } from "@/v1/repositories/evidenceRepository";
import type { ClaimEvidenceRelation } from "@/db/constants";
import { canReadEvidenceInternal } from "@/v1/services/evidenceService";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function actorUserId(ctx: AccessContext): string | null {
  if (ctx.kind === "USER" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.userId;
  }
  return null;
}

function mapPerm(e: unknown): never {
  if (e instanceof PermissionDomainError) {
    if (e.code === "FAMILY_NOT_FOUND") {
      throw new ClaimDomainError("FAMILY_NOT_FOUND");
    }
    if (e.code === "PERSON_NOT_FOUND") {
      throw new ClaimDomainError("SUBJECT_NOT_FOUND");
    }
    throw new ClaimDomainError("FORBIDDEN");
  }
  throw e;
}

async function assertCanReadSubject(
  database: V1Db | claimRepo.DbOrTx,
  args: {
    familyId: string;
    subjectType: ClaimSubjectType;
    subjectId: string;
    claimType: ClaimType;
    value: ClaimValue;
    actorContext: AccessContext;
  }
): Promise<void> {
  const { familyId, subjectType, subjectId, claimType, value, actorContext } =
    args;

  if (subjectType === "FAMILY") {
    if (subjectId !== familyId) {
      throw new ClaimDomainError("INVALID_INPUT", "FAMILY subject_id must equal familyId");
    }
    const auth = await authorizeFamilyRead(familyId, actorContext, {
      db: database as V1Db,
    }).catch(mapPerm);
    if (auth.decision !== "ALLOW") {
      throw new ClaimDomainError("SUBJECT_NOT_READABLE");
    }
    return;
  }

  if (subjectType === "PERSON") {
    const person = await personRepo.findActivePersonById(database, subjectId);
    if (!person || person.familyId !== familyId) {
      throw new ClaimDomainError(
        person ? "CROSS_FAMILY" : "SUBJECT_NOT_FOUND"
      );
    }
    const auth = await authorizePersonRead(subjectId, actorContext, {
      db: database as V1Db,
      expectedFamilyId: familyId,
    }).catch(mapPerm);
    if (auth.decision !== "ALLOW") {
      throw new ClaimDomainError("SUBJECT_NOT_READABLE");
    }

    if (claimType === "RELATIONSHIP_ASSERTION") {
      const assertion = value as RelationshipAssertionValue;
      if (assertion.otherPersonId === subjectId) {
        throw new ClaimDomainError("SELF_ASSERTION");
      }
      const other = await personRepo.findActivePersonById(
        database,
        assertion.otherPersonId
      );
      if (!other) {
        throw new ClaimDomainError("SUBJECT_NOT_FOUND");
      }
      if (other.familyId !== familyId) {
        throw new ClaimDomainError("CROSS_FAMILY");
      }
      const otherAuth = await authorizePersonRead(
        assertion.otherPersonId,
        actorContext,
        { db: database as V1Db, expectedFamilyId: familyId }
      ).catch(mapPerm);
      if (otherAuth.decision !== "ALLOW") {
        throw new ClaimDomainError("SUBJECT_NOT_READABLE");
      }
    }
    return;
  }

  // RELATIONSHIP subject
  const rel = await relRepo.findActiveRelationshipById(database, subjectId);
  if (!rel || rel.familyId !== familyId) {
    throw new ClaimDomainError(rel ? "CROSS_FAMILY" : "SUBJECT_NOT_FOUND");
  }
  // Require ACCEPTED canonical edge
  if (rel.status !== "ACCEPTED") {
    throw new ClaimDomainError("RELATIONSHIP_NOT_ACCEPTED");
  }
  const famAuth = await authorizeFamilyRead(familyId, actorContext, {
    db: database as V1Db,
  }).catch(mapPerm);
  if (famAuth.decision !== "ALLOW") {
    throw new ClaimDomainError("SUBJECT_NOT_READABLE");
  }
  for (const pid of [rel.fromPersonId, rel.toPersonId]) {
    const pAuth = await authorizePersonRead(pid, actorContext, {
      db: database as V1Db,
      expectedFamilyId: familyId,
    }).catch(mapPerm);
    if (pAuth.decision !== "ALLOW") {
      throw new ClaimDomainError("SUBJECT_NOT_READABLE");
    }
  }
}

/**
 * Conflict Engine — SINGLETON only.
 * distinct fingerprints among ACCEPTED|CONFLICTED → all CONFLICTED; else all ACCEPTED.
 * Callers must never set CONFLICTED directly.
 */
export async function recomputeSingletonConflicts(
  db: claimRepo.DbOrTx,
  args: {
    familyId: string;
    subjectType: string;
    subjectId: string;
    claimType: ClaimType;
    now: Date;
  }
): Promise<{ conflictCount: number; changedClaimCount: number }> {
  const def = getClaimTypeDefinition(args.claimType);
  if (!def || def.cardinality !== "SINGLETON") {
    return { conflictCount: 0, changedClaimCount: 0 };
  }

  const rows = await claimRepo.listConflictCandidates(db, {
    familyId: args.familyId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    claimType: args.claimType,
  });

  const fingerprints = new Set(rows.map((r) => r.valueFingerprint));
  const targetStatus: "ACCEPTED" | "CONFLICTED" =
    fingerprints.size > 1 ? "CONFLICTED" : "ACCEPTED";

  const updates = rows
    .filter((r) => r.status !== targetStatus)
    .map((r) => ({ id: r.id, status: targetStatus }));

  const changedClaimCount = await claimRepo.setClaimConflictStatuses(
    db,
    updates,
    args.now
  );

  return {
    conflictCount: fingerprints.size > 1 ? fingerprints.size : 0,
    changedClaimCount,
  };
}

export async function createClaim(
  input: CreateClaimInput,
  options?: { db?: V1Db }
): Promise<CreateClaimResult> {
  const validated = validateCreateClaimInput(input);
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(input.actorContext);
  const fingerprint = computeValueFingerprint(
    validated.claimType,
    validated.normalized
  );

  const editAuth = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "EDIT_CLAIM",
    { db: database }
  ).catch(mapPerm);
  if (editAuth.decision !== "ALLOW") {
    throw new ClaimDomainError("FORBIDDEN");
  }

  await assertCanReadSubject(database, {
    familyId: validated.familyId,
    subjectType: validated.subjectType,
    subjectId: validated.subjectId,
    claimType: validated.claimType,
    value: validated.normalized,
    actorContext: input.actorContext,
  });

  const dup = await claimRepo.findActiveDuplicate(database, {
    familyId: validated.familyId,
    subjectType: validated.subjectType,
    subjectId: validated.subjectId,
    claimType: validated.claimType,
    valueFingerprint: fingerprint,
  });
  if (dup) {
    throw new ClaimDomainError("DUPLICATE_ACTIVE_CLAIM");
  }

  const claimId = randomUUID();
  const now = new Date();

  const familyVersion = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, validated.familyId);
    if (!family) {
      throw new ClaimDomainError("FAMILY_NOT_FOUND");
    }

    const dup2 = await claimRepo.findActiveDuplicate(tx, {
      familyId: validated.familyId,
      subjectType: validated.subjectType,
      subjectId: validated.subjectId,
      claimType: validated.claimType,
      valueFingerprint: fingerprint,
    });
    if (dup2) {
      throw new ClaimDomainError("DUPLICATE_ACTIVE_CLAIM");
    }

    await claimRepo.insertClaim(tx, {
      id: claimId,
      familyId: validated.familyId,
      subjectType: validated.subjectType,
      subjectId: validated.subjectId,
      claimType: validated.claimType,
      valueJson: validated.value,
      normalizedJson: validated.normalized,
      valueFingerprint: fingerprint,
      confidence:
        validated.confidence === null ? null : String(validated.confidence),
      originType: validated.originType,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });

    return advanceFamilyVersion(tx, {
      familyId: validated.familyId,
      actorUserId: userId,
      summary: "CLAIM_CREATED",
      eventType: "CLAIM_CREATED",
      entityType: "CLAIM",
      entityId: claimId,
      metadataJson: {
        claimType: validated.claimType,
        subjectType: validated.subjectType,
        originType: validated.originType,
      },
      now: new Date(),
    });
  });

  const row = await claimRepo.findActiveClaimById(database, claimId);
  if (!row) {
    throw new ClaimDomainError("CLAIM_NOT_FOUND");
  }

  return { claim: claimRepo.mapClaimDto(row), familyVersion };
}

export async function acceptClaim(
  familyId: string,
  claimId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<ReviewClaimResult> {
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(actorContext);
  if (!userId) {
    throw new ClaimDomainError("FORBIDDEN");
  }

  const reviewAuth = await authorizeFamilyAction(
    familyId,
    actorContext,
    "REVIEW_CLAIM",
    { db: database }
  ).catch(mapPerm);
  if (reviewAuth.decision !== "ALLOW") {
    throw new ClaimDomainError("FORBIDDEN");
  }

  const now = new Date();

  const result = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, familyId);
    if (!family) {
      throw new ClaimDomainError("FAMILY_NOT_FOUND");
    }

    const existing = await claimRepo.findActiveClaimById(tx, claimId);
    if (!existing || existing.familyId !== familyId) {
      throw new ClaimDomainError("CLAIM_NOT_FOUND");
    }
    if (existing.status !== "PROPOSED") {
      throw new ClaimDomainError("INVALID_CLAIM_STATUS_TRANSITION");
    }

    const updated = await claimRepo.tryReviewProposedClaim(tx, {
      claimId,
      nextStatus: "ACCEPTED",
      reviewedByUserId: userId,
      reviewedAt: now,
      updatedAt: now,
    });
    if (!updated) {
      throw new ClaimDomainError("REVIEW_CONFLICT");
    }

    const recompute = await recomputeSingletonConflicts(tx, {
      familyId,
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      claimType: existing.claimType as ClaimType,
      now,
    });

    const finalRow = await claimRepo.findActiveClaimById(tx, claimId);
    if (!finalRow) {
      throw new ClaimDomainError("CLAIM_NOT_FOUND");
    }

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId,
      actorUserId: userId,
      summary: "CLAIM_ACCEPTED",
      eventType: "CLAIM_ACCEPTED",
      entityType: "CLAIM",
      entityId: claimId,
      metadataJson: {
        claimType: existing.claimType,
        subjectType: existing.subjectType,
        conflictCount: recompute.conflictCount,
        changedClaimCount: recompute.changedClaimCount,
      },
      now: new Date(),
    });

    return {
      claim: claimRepo.mapClaimDto(finalRow),
      familyVersion,
      conflictCount: recompute.conflictCount,
      changedClaimCount: recompute.changedClaimCount,
    };
  });

  return result;
}

export async function rejectClaim(
  familyId: string,
  claimId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<ReviewClaimResult> {
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(actorContext);
  if (!userId) {
    throw new ClaimDomainError("FORBIDDEN");
  }

  const reviewAuth = await authorizeFamilyAction(
    familyId,
    actorContext,
    "REVIEW_CLAIM",
    { db: database }
  ).catch(mapPerm);
  if (reviewAuth.decision !== "ALLOW") {
    throw new ClaimDomainError("FORBIDDEN");
  }

  const now = new Date();

  return database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, familyId);
    if (!family) {
      throw new ClaimDomainError("FAMILY_NOT_FOUND");
    }

    const existing = await claimRepo.findActiveClaimById(tx, claimId);
    if (!existing || existing.familyId !== familyId) {
      throw new ClaimDomainError("CLAIM_NOT_FOUND");
    }

    if (
      existing.status !== "PROPOSED" &&
      existing.status !== "ACCEPTED" &&
      existing.status !== "CONFLICTED"
    ) {
      throw new ClaimDomainError("INVALID_CLAIM_STATUS_TRANSITION");
    }

    let updated;
    if (existing.status === "PROPOSED") {
      updated = await claimRepo.tryReviewProposedClaim(tx, {
        claimId,
        nextStatus: "REJECTED",
        reviewedByUserId: userId,
        reviewedAt: now,
        updatedAt: now,
      });
    } else {
      updated = await claimRepo.tryRejectReviewedClaim(tx, {
        claimId,
        reviewedByUserId: userId,
        reviewedAt: now,
        updatedAt: now,
      });
    }
    if (!updated) {
      throw new ClaimDomainError("REVIEW_CONFLICT");
    }

    const recompute = await recomputeSingletonConflicts(tx, {
      familyId,
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      claimType: existing.claimType as ClaimType,
      now,
    });

    const finalRow = await claimRepo.findActiveClaimById(tx, claimId);
    if (!finalRow) {
      throw new ClaimDomainError("CLAIM_NOT_FOUND");
    }

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId,
      actorUserId: userId,
      summary: "CLAIM_REJECTED",
      eventType: "CLAIM_REJECTED",
      entityType: "CLAIM",
      entityId: claimId,
      metadataJson: {
        claimType: existing.claimType,
        subjectType: existing.subjectType,
        conflictCount: recompute.conflictCount,
        changedClaimCount: recompute.changedClaimCount,
      },
      now: new Date(),
    });

    return {
      claim: claimRepo.mapClaimDto(finalRow),
      familyVersion,
      conflictCount: recompute.conflictCount,
      changedClaimCount: recompute.changedClaimCount,
    };
  });
}

export async function canReadClaim(
  row: {
    familyId: string;
    subjectType: string;
    subjectId: string;
    claimType: string;
    valueJson: unknown;
  },
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<boolean> {
  const database = dbOrDefault(options?.db);
  try {
    await assertCanReadSubject(database, {
      familyId: row.familyId,
      subjectType: row.subjectType as ClaimSubjectType,
      subjectId: row.subjectId,
      claimType: row.claimType as ClaimType,
      value: row.valueJson as ClaimValue,
      actorContext,
    });
    return true;
  } catch (e) {
    if (e instanceof ClaimDomainError) {
      if (
        e.code === "SUBJECT_NOT_READABLE" ||
        e.code === "FORBIDDEN" ||
        e.code === "SUBJECT_NOT_FOUND" ||
        e.code === "CROSS_FAMILY"
      ) {
        return false;
      }
    }
    throw e;
  }
}

export async function getClaim(
  claimId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<ClaimDto | null> {
  const database = dbOrDefault(options?.db);
  const row = await claimRepo.findActiveClaimById(database, claimId);
  if (!row) return null;
  const ok = await canReadClaim(row, actorContext, { db: database });
  if (!ok) return null;
  return claimRepo.mapClaimDto(row);
}

export async function getClaimsForSubject(
  familyId: string,
  subjectType: ClaimSubjectType,
  subjectId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<ClaimDto[]> {
  const database = dbOrDefault(options?.db);
  const rows = await claimRepo.listActiveClaimsForSubject(database, {
    familyId,
    subjectType,
    subjectId,
  });
  const out: ClaimDto[] = [];
  for (const row of rows) {
    const ok = await canReadClaim(row, actorContext, { db: database });
    if (ok) out.push(claimRepo.mapClaimDto(row));
  }
  return out;
}

export async function getClaimWithEvidence(
  claimId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<ClaimBundle | null> {
  const database = dbOrDefault(options?.db);
  const claim = await getClaim(claimId, actorContext, { db: database });
  if (!claim) return null;

  const links = await evidenceRepo.listActiveLinksForClaim(database, claimId);
  const evidenceLinks: Array<{
    relation: ClaimEvidenceRelation;
    evidence: ReturnType<typeof mapEvidenceDto>;
  }> = [];

  for (const link of links) {
    const readable = await canReadEvidenceInternal(
      link.evidence,
      actorContext,
      { db: database }
    );
    if (readable) {
      evidenceLinks.push({
        relation: link.relation,
        evidence: mapEvidenceDto(link.evidence),
      });
    }
  }

  return { claim, evidenceLinks };
}

/** Internal: expose status for smoke without fingerprint. */
export function claimStatusOf(dto: ClaimDto): ClaimStatus {
  return dto.status;
}
