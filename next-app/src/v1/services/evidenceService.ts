/**
 * Evidence Service — sources linked to Claims; never bypasses Person/Media privacy.
 * Evidence DTO never includes signed URLs or storage keys.
 */

import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { EvidenceDomainError } from "@/v1/domain/evidence/errors";
import {
  validateCreateEvidenceInput,
  validateLinkEvidenceInput,
} from "@/v1/domain/evidence/validation";
import type {
  CreateEvidenceInput,
  CreateEvidenceResult,
  DeleteEvidenceResult,
  EvidenceDto,
  LinkEvidenceInput,
  LinkEvidenceResult,
} from "@/v1/domain/evidence/types";
import type { AccessContext } from "@/v1/domain/permission/types";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  authorizeEvidenceAction,
  authorizeFamilyAction,
  authorizeMediaAction,
} from "@/v1/services/permissionService";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";
import * as evidenceRepo from "@/v1/repositories/evidenceRepository";
import * as claimRepo from "@/v1/repositories/claimRepository";
import * as mediaRepo from "@/v1/repositories/mediaRepository";

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
      throw new EvidenceDomainError("FAMILY_NOT_FOUND");
    }
    if (e.code === "EVIDENCE_NOT_FOUND") {
      throw new EvidenceDomainError("EVIDENCE_NOT_FOUND");
    }
    if (e.code === "MEDIA_NOT_FOUND") {
      throw new EvidenceDomainError("MEDIA_NOT_FOUND");
    }
    throw new EvidenceDomainError("FORBIDDEN");
  }
  throw e;
}

/**
 * Full Evidence read gate including PUBLIC orphan / subject / media ceilings.
 * Used by EvidenceService and Claim bundle filtering.
 */
export async function canReadEvidenceInternal(
  row: typeof import("@/db/schema").evidence.$inferSelect,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<boolean> {
  const database = dbOrDefault(options?.db);

  const base = await authorizeEvidenceAction(
    row.id,
    actorContext,
    "READ_EVIDENCE",
    { db: database }
  ).catch((e) => {
    if (e instanceof PermissionDomainError) return null;
    throw e;
  });
  if (!base || base.decision !== "ALLOW") return false;

  // Family members (and OWNER/ADMIN for PRIVATE) — base policy is enough
  if (base.activeRole) {
    // Still enforce media ceiling for PRIVATE media when returning to EDITOR?
    // Spec P06 is about anonymous. Members with role can read FAMILY evidence
    // even if media is PRIVATE? Spec: "不得通过 Evidence得到 private Media signed URL"
    // Metadata DENY for external. For family members reading FAMILY evidence with
    // PRIVATE media — EDITOR cannot READ_MEDIA PRIVATE, but can they see Evidence?
    // Conservative for external only; members keep Evidence metadata.
    return true;
  }

  // Non-member path (PUBLIC evidence under family ceiling)
  if (row.visibility !== "PUBLIC") return false;

  // Orphan PUBLIC → DENY
  const links = await evidenceRepo.listActiveLinksForEvidence(database, row.id);
  if (links.length === 0) return false;

  // Must have at least one readable Claim (subject privacy)
  const { canReadClaim } = await import("@/v1/services/claimService");
  let anyReadableClaim = false;
  for (const link of links) {
    const claim = await claimRepo.findActiveClaimById(database, link.claimId);
    if (!claim || claim.deletedAt) continue;
    const ok = await canReadClaim(claim, actorContext, { db: database });
    if (ok) {
      anyReadableClaim = true;
      break;
    }
  }
  if (!anyReadableClaim) return false;

  // Private media ceiling — DENY entire Evidence to external
  if (row.mediaObjectId) {
    const mediaAuth = await authorizeMediaAction(
      row.mediaObjectId,
      actorContext,
      "READ_MEDIA",
      { db: database }
    ).catch(() => null);
    if (!mediaAuth || mediaAuth.decision !== "ALLOW") return false;
  }

  return true;
}

export async function createEvidence(
  input: CreateEvidenceInput,
  options?: { db?: V1Db }
): Promise<CreateEvidenceResult> {
  const validated = validateCreateEvidenceInput(input);
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(input.actorContext);

  const editAuth = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "EDIT_EVIDENCE",
    { db: database }
  ).catch(mapPerm);
  if (editAuth.decision !== "ALLOW") {
    throw new EvidenceDomainError("FORBIDDEN");
  }

  // PRIVATE / PUBLIC require MANAGE_PRIVACY (OWNER/ADMIN)
  if (validated.visibility === "PRIVATE" || validated.visibility === "PUBLIC") {
    const privacyAuth = await authorizeFamilyAction(
      validated.familyId,
      input.actorContext,
      "MANAGE_PRIVACY",
      { db: database }
    ).catch(mapPerm);
    if (privacyAuth.decision !== "ALLOW") {
      throw new EvidenceDomainError("FORBIDDEN");
    }
  }

  // EDITOR may only create FAMILY
  if (editAuth.activeRole === "EDITOR" && validated.visibility !== "FAMILY") {
    throw new EvidenceDomainError("FORBIDDEN");
  }

  if (validated.mediaObjectId) {
    const media = await mediaRepo.findMediaById(
      database,
      validated.mediaObjectId
    );
    if (!media || media.deletedAt) {
      throw new EvidenceDomainError("MEDIA_NOT_FOUND");
    }
    if (media.familyId !== validated.familyId) {
      throw new EvidenceDomainError("CROSS_FAMILY");
    }
    if (media.status !== "ACTIVE") {
      throw new EvidenceDomainError("MEDIA_NOT_FOUND");
    }
    const mediaAuth = await authorizeMediaAction(
      validated.mediaObjectId,
      input.actorContext,
      "READ_MEDIA",
      { db: database }
    ).catch(mapPerm);
    if (mediaAuth.decision !== "ALLOW") {
      throw new EvidenceDomainError("MEDIA_NOT_READABLE");
    }
  }

  const evidenceId = randomUUID();
  const now = new Date();

  const familyVersion = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, validated.familyId);
    if (!family) {
      throw new EvidenceDomainError("FAMILY_NOT_FOUND");
    }

    await evidenceRepo.insertEvidence(tx, {
      id: evidenceId,
      familyId: validated.familyId,
      evidenceType: validated.evidenceType,
      title: validated.title,
      description: validated.description,
      mediaObjectId: validated.mediaObjectId,
      sourceLocator: validated.sourceLocator,
      sourceDateText: validated.sourceDateText,
      visibility: validated.visibility,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });

    return advanceFamilyVersion(tx, {
      familyId: validated.familyId,
      actorUserId: userId,
      summary: "EVIDENCE_CREATED",
      eventType: "EVIDENCE_CREATED",
      entityType: "EVIDENCE",
      entityId: evidenceId,
      metadataJson: {
        evidenceType: validated.evidenceType,
      },
      now: new Date(),
    });
  });

  const row = await evidenceRepo.findActiveEvidenceById(database, evidenceId);
  if (!row) {
    throw new EvidenceDomainError("EVIDENCE_NOT_FOUND");
  }

  return {
    evidence: evidenceRepo.mapEvidenceDto(row),
    familyVersion,
  };
}

export async function deleteEvidence(
  familyId: string,
  evidenceId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<DeleteEvidenceResult> {
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(actorContext);

  const delAuth = await authorizeEvidenceAction(
    evidenceId,
    actorContext,
    "DELETE_EVIDENCE",
    { db: database }
  ).catch(mapPerm);
  if (delAuth.decision !== "ALLOW") {
    throw new EvidenceDomainError("FORBIDDEN");
  }
  if (delAuth.evidenceFamilyId !== familyId) {
    throw new EvidenceDomainError("CROSS_FAMILY");
  }

  const now = new Date();

  const familyVersion = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, familyId);
    if (!family) {
      throw new EvidenceDomainError("FAMILY_NOT_FOUND");
    }

    const ok = await evidenceRepo.softDeleteEvidence(tx, evidenceId, now);
    if (!ok) {
      throw new EvidenceDomainError("EVIDENCE_NOT_FOUND");
    }

    return advanceFamilyVersion(tx, {
      familyId,
      actorUserId: userId,
      summary: "EVIDENCE_DELETED",
      eventType: "EVIDENCE_DELETED",
      entityType: "EVIDENCE",
      entityId: evidenceId,
      metadataJson: {},
      now: new Date(),
    });
  });

  return { evidenceId, familyVersion };
}

export async function getEvidence(
  evidenceId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<EvidenceDto | null> {
  const database = dbOrDefault(options?.db);
  const row = await evidenceRepo.findActiveEvidenceById(database, evidenceId);
  if (!row) return null;
  const ok = await canReadEvidenceInternal(row, actorContext, { db: database });
  if (!ok) return null;
  return evidenceRepo.mapEvidenceDto(row);
}

export async function linkEvidenceToClaim(
  input: LinkEvidenceInput,
  options?: { db?: V1Db }
): Promise<LinkEvidenceResult> {
  const validated = validateLinkEvidenceInput(input);
  const database = dbOrDefault(options?.db);
  const userId = actorUserId(input.actorContext);

  const claimEdit = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "EDIT_CLAIM",
    { db: database }
  ).catch(mapPerm);
  if (claimEdit.decision !== "ALLOW") {
    throw new EvidenceDomainError("FORBIDDEN");
  }
  const evidenceEdit = await authorizeFamilyAction(
    validated.familyId,
    input.actorContext,
    "EDIT_EVIDENCE",
    { db: database }
  ).catch(mapPerm);
  if (evidenceEdit.decision !== "ALLOW") {
    throw new EvidenceDomainError("FORBIDDEN");
  }

  const claim = await claimRepo.findActiveClaimById(database, validated.claimId);
  if (!claim || claim.familyId !== validated.familyId) {
    throw new EvidenceDomainError(
      claim ? "CROSS_FAMILY" : "CLAIM_NOT_FOUND"
    );
  }

  const ev = await evidenceRepo.findActiveEvidenceById(
    database,
    validated.evidenceId
  );
  if (!ev || ev.familyId !== validated.familyId) {
    throw new EvidenceDomainError(ev ? "CROSS_FAMILY" : "EVIDENCE_NOT_FOUND");
  }

  const { canReadClaim } = await import("@/v1/services/claimService");
  const claimReadable = await canReadClaim(claim, input.actorContext, {
    db: database,
  });
  if (!claimReadable) {
    throw new EvidenceDomainError("FORBIDDEN");
  }
  const evidenceReadable = await canReadEvidenceInternal(
    ev,
    input.actorContext,
    { db: database }
  );
  if (!evidenceReadable) {
    throw new EvidenceDomainError("FORBIDDEN");
  }

  const existing = await evidenceRepo.findClaimEvidenceLink(
    database,
    validated.claimId,
    validated.evidenceId
  );
  if (existing) {
    throw new EvidenceDomainError("EVIDENCE_ALREADY_LINKED");
  }

  const now = new Date();

  const familyVersion = await database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, validated.familyId);
    if (!family) {
      throw new EvidenceDomainError("FAMILY_NOT_FOUND");
    }

    const again = await evidenceRepo.findClaimEvidenceLink(
      tx,
      validated.claimId,
      validated.evidenceId
    );
    if (again) {
      throw new EvidenceDomainError("EVIDENCE_ALREADY_LINKED");
    }

    await evidenceRepo.insertClaimEvidenceLink(tx, {
      claimId: validated.claimId,
      evidenceId: validated.evidenceId,
      relation: validated.relation,
      createdByUserId: userId,
      createdAt: now,
    });

    return advanceFamilyVersion(tx, {
      familyId: validated.familyId,
      actorUserId: userId,
      summary: "CLAIM_EVIDENCE_LINKED",
      eventType: "CLAIM_EVIDENCE_LINKED",
      entityType: "CLAIM_EVIDENCE",
      entityId: validated.claimId,
      metadataJson: {
        relation: validated.relation,
        evidenceType: ev.evidenceType,
      },
      now: new Date(),
    });
  });

  return {
    claimId: validated.claimId,
    evidenceId: validated.evidenceId,
    relation: validated.relation,
    familyVersion,
  };
}
