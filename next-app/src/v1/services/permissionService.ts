/**
 * Permission Service — sole authority for V1 ACL decisions.
 * Roles always loaded from DB; never trusted from caller.
 * Share tokens re-validated on every authorize (no permanent cache).
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { MembershipRole } from "@/db/constants";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  decideEvidenceAction,
  decideFamilyAction,
  decideMediaAction,
  decidePersonAction,
  decidePersonRead,
} from "@/v1/domain/permission/policy";
import { hashShareToken } from "@/v1/domain/permission/shareToken";
import type {
  AccessContext,
  Decision,
  PermissionAction,
} from "@/v1/domain/permission/types";
import * as repo from "@/v1/repositories/permissionRepository";
import type { DbOrTx } from "@/v1/repositories/permissionRepository";

function dbOrDefault(db?: DbOrTx): DbOrTx {
  return db ?? getV1Db();
}

function extractUserId(ctx: AccessContext): string | null {
  if (ctx.kind === "USER" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.userId;
  }
  return null;
}

function extractRawToken(ctx: AccessContext): string | null {
  if (ctx.kind === "SHARE_LINK" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.rawToken;
  }
  return null;
}

/**
 * Resolve ACTIVE membership role from DB.
 * SUSPENDED → treated as no membership.
 */
async function resolveActiveRole(
  database: DbOrTx,
  familyId: string,
  userId: string | null
): Promise<MembershipRole | null> {
  if (!userId) return null;
  const m = await repo.findMembershipForAccess(database, familyId, userId);
  if (!m || m.status !== "ACTIVE") return null;
  return m.role;
}

/**
 * Validate share token against DB every call — revoked/expired fail immediately.
 * Does not log raw token or hash.
 */
async function resolveValidShareLink(
  database: DbOrTx,
  familyId: string,
  rawToken: string | null,
  now: Date
): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = hashShareToken(rawToken);
  const link = await repo.findShareLinkByTokenHash(database, tokenHash);
  if (!link) return false;
  if (link.familyId !== familyId) return false;
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export type AuthorizeFamilyResult = {
  decision: Decision;
  activeRole: MembershipRole | null;
  validShareLink: boolean;
};

/**
 * Authorize an action on a family. Resource familyId must be the real one.
 */
export async function authorizeFamilyAction(
  familyId: string,
  ctx: AccessContext,
  action: PermissionAction,
  options?: { db?: DbOrTx; now?: Date }
): Promise<AuthorizeFamilyResult> {
  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  const family = await repo.findFamilyForAccess(database, familyId);
  if (!family) {
    throw new PermissionDomainError("FAMILY_NOT_FOUND");
  }

  const userId = extractUserId(ctx);
  const rawToken = extractRawToken(ctx);
  const activeRole = await resolveActiveRole(database, familyId, userId);
  const validShareLink = await resolveValidShareLink(
    database,
    familyId,
    rawToken,
    now
  );

  const decision = decideFamilyAction({
    familyVisibility: family.visibility,
    familyDeleted: family.deletedAt != null,
    activeRole,
    validShareLink,
    action,
  });

  return { decision, activeRole, validShareLink };
}

export type AuthorizePersonResult = AuthorizeFamilyResult & {
  personFamilyId: string;
};

/**
 * Authorize person read/mutation. Always binds to person.familyId from DB
 * so Family A membership cannot authorize Family B person.
 */
export async function authorizePersonAction(
  personId: string,
  ctx: AccessContext,
  action: PermissionAction,
  options?: { db?: DbOrTx; now?: Date; expectedFamilyId?: string }
): Promise<AuthorizePersonResult> {
  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  const person = await repo.findPersonForAccess(database, personId);
  if (!person) {
    throw new PermissionDomainError("PERSON_NOT_FOUND");
  }

  // Cross-family guard when caller asserts a familyId
  if (
    options?.expectedFamilyId &&
    options.expectedFamilyId !== person.familyId
  ) {
    return {
      decision: "DENY",
      activeRole: null,
      validShareLink: false,
      personFamilyId: person.familyId,
    };
  }

  const family = await repo.findFamilyForAccess(database, person.familyId);
  if (!family) {
    throw new PermissionDomainError("FAMILY_NOT_FOUND");
  }

  const userId = extractUserId(ctx);
  const rawToken = extractRawToken(ctx);
  const activeRole = await resolveActiveRole(
    database,
    person.familyId,
    userId
  );
  const validShareLink = await resolveValidShareLink(
    database,
    person.familyId,
    rawToken,
    now
  );

  const input = {
    familyVisibility: family.visibility,
    familyDeleted: family.deletedAt != null,
    activeRole,
    validShareLink,
    action,
    privacyLevel: person.privacyLevel,
    livingStatus: person.livingStatus,
    personDeleted: person.deletedAt != null,
  };

  const decision =
    action === "READ_PERSON"
      ? decidePersonRead(input)
      : decidePersonAction(input);

  return {
    decision,
    activeRole,
    validShareLink,
    personFamilyId: person.familyId,
  };
}

/** Convenience: READ_FAMILY */
export async function authorizeFamilyRead(
  familyId: string,
  ctx: AccessContext,
  options?: { db?: DbOrTx; now?: Date }
) {
  return authorizeFamilyAction(familyId, ctx, "READ_FAMILY", options);
}

/** Convenience: READ_PERSON */
export async function authorizePersonRead(
  personId: string,
  ctx: AccessContext,
  options?: { db?: DbOrTx; now?: Date; expectedFamilyId?: string }
) {
  return authorizePersonAction(personId, ctx, "READ_PERSON", options);
}

export type AuthorizeMediaResult = AuthorizeFamilyResult & {
  mediaFamilyId: string;
  mediaActive: boolean;
};

/**
 * Authorize READ_MEDIA / DELETE_MEDIA using media visibility + family ceiling.
 */
export async function authorizeMediaAction(
  mediaId: string,
  ctx: AccessContext,
  action: "READ_MEDIA" | "DELETE_MEDIA",
  options?: { db?: DbOrTx; now?: Date }
): Promise<AuthorizeMediaResult> {
  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  const media = await repo.findMediaForAccess(database, mediaId);
  if (!media) {
    throw new PermissionDomainError("MEDIA_NOT_FOUND");
  }

  const family = await repo.findFamilyForAccess(database, media.familyId);
  if (!family) {
    throw new PermissionDomainError("FAMILY_NOT_FOUND");
  }

  const userId = extractUserId(ctx);
  const rawToken = extractRawToken(ctx);
  const activeRole = await resolveActiveRole(database, media.familyId, userId);
  const validShareLink = await resolveValidShareLink(
    database,
    media.familyId,
    rawToken,
    now
  );

  const mediaActive = media.status === "ACTIVE";

  const decision = decideMediaAction({
    familyVisibility: family.visibility,
    familyDeleted: family.deletedAt != null,
    activeRole,
    validShareLink,
    action,
    mediaVisibility: media.visibility,
    mediaActive,
  });

  return {
    decision,
    activeRole,
    validShareLink,
    mediaFamilyId: media.familyId,
    mediaActive,
  };
}

export type AuthorizeEvidenceResult = AuthorizeFamilyResult & {
  evidenceFamilyId: string;
  evidenceActive: boolean;
  mediaObjectId: string | null;
};

/**
 * Authorize READ_EVIDENCE / DELETE_EVIDENCE using evidence visibility + family ceiling.
 * Orphan / subject / media ceilings for PUBLIC external reads are applied in EvidenceService.
 */
export async function authorizeEvidenceAction(
  evidenceId: string,
  ctx: AccessContext,
  action: "READ_EVIDENCE" | "DELETE_EVIDENCE",
  options?: { db?: DbOrTx; now?: Date }
): Promise<AuthorizeEvidenceResult> {
  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  const row = await repo.findEvidenceForAccess(database, evidenceId);
  if (!row) {
    throw new PermissionDomainError("EVIDENCE_NOT_FOUND");
  }

  const family = await repo.findFamilyForAccess(database, row.familyId);
  if (!family) {
    throw new PermissionDomainError("FAMILY_NOT_FOUND");
  }

  const userId = extractUserId(ctx);
  const rawToken = extractRawToken(ctx);
  const activeRole = await resolveActiveRole(database, row.familyId, userId);
  const validShareLink = await resolveValidShareLink(
    database,
    row.familyId,
    rawToken,
    now
  );

  const evidenceActive = row.deletedAt == null;

  const decision = decideEvidenceAction({
    familyVisibility: family.visibility,
    familyDeleted: family.deletedAt != null,
    activeRole,
    validShareLink,
    action,
    evidenceVisibility: row.visibility,
    evidenceActive,
  });

  return {
    decision,
    activeRole,
    validShareLink,
    evidenceFamilyId: row.familyId,
    evidenceActive,
    mediaObjectId: row.mediaObjectId,
  };
}
