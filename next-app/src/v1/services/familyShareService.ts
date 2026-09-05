/**
 * Family share-link service — READ-only tokens.
 * Raw token returned once to caller; never logged; only hash stored.
 */

import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  generateShareRawToken,
  hashShareToken,
} from "@/v1/domain/permission/shareToken";
import { authorizeFamilyAction } from "@/v1/services/permissionService";
import * as repo from "@/v1/repositories/permissionRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export type CreateShareLinkResult = {
  linkId: string;
  /** Returned once — never persist or log. */
  rawToken: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * Create READ share link. OWNER / ADMIN only (via PermissionService).
 */
export async function createFamilyShareLink(
  familyId: string,
  actorUserId: string,
  options?: { db?: V1Db; expiresAt?: Date | null }
): Promise<CreateShareLinkResult> {
  const database = dbOrDefault(options?.db);

  const auth = await authorizeFamilyAction(
    familyId,
    { kind: "USER", userId: actorUserId },
    "MANAGE_SHARE_LINKS",
    { db: database }
  );
  if (auth.decision !== "ALLOW") {
    throw new PermissionDomainError("FORBIDDEN");
  }

  const family = await repo.findFamilyForAccess(database, familyId);
  if (!family || family.deletedAt) {
    throw new PermissionDomainError("FAMILY_NOT_FOUND");
  }

  const rawToken = generateShareRawToken();
  const tokenHash = hashShareToken(rawToken);
  const linkId = randomUUID();
  const createdAt = new Date();
  const expiresAt =
    options?.expiresAt === undefined ? null : options.expiresAt;

  await repo.insertShareLink(database, {
    id: linkId,
    familyId,
    createdByUserId: actorUserId,
    tokenHash,
    expiresAt,
    createdAt,
  });

  return { linkId, rawToken, expiresAt, createdAt };
}

/**
 * Revoke share link immediately. OWNER / ADMIN only.
 */
export async function revokeFamilyShareLink(
  familyId: string,
  linkId: string,
  actorUserId: string,
  options?: { db?: V1Db }
): Promise<void> {
  const database = dbOrDefault(options?.db);

  const auth = await authorizeFamilyAction(
    familyId,
    { kind: "USER", userId: actorUserId },
    "MANAGE_SHARE_LINKS",
    { db: database }
  );
  if (auth.decision !== "ALLOW") {
    throw new PermissionDomainError("FORBIDDEN");
  }

  const link = await repo.findShareLinkById(database, linkId);
  if (!link || link.familyId !== familyId) {
    throw new PermissionDomainError("SHARE_LINK_NOT_FOUND");
  }

  if (link.revokedAt) return;

  await repo.revokeShareLinkById(database, linkId, new Date());
}
