/**
 * Family invites — single-use links that add a signed-in user to a family.
 *
 * OWNER may invite ADMIN / EDITOR / VIEWER; ADMIN may invite EDITOR / VIEWER.
 * The raw token is returned once and never stored or logged. Accepting an
 * invite never grants Closed Alpha registration: the user must already be
 * able to sign in.
 */

import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getV1Db, type V1Db } from "@/db/client";
import { familyMemberships, users } from "@/db/schema";
import type { MembershipRole } from "@/db/constants";
import { InviteDomainError } from "@/v1/domain/invite/errors";
import {
  generateShareRawToken,
  hashShareToken,
} from "@/v1/domain/permission/shareToken";
import { decryptEmail } from "@/v1/domain/auth/crypto";
import { authorizeFamilyAction } from "@/v1/services/permissionService";
import * as inviteRepo from "@/v1/repositories/familyInviteRepository";
import * as familyRepo from "@/v1/repositories/familyRepository";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const tip = local.slice(0, Math.min(2, local.length));
  return `${tip}***@${domain}`;
}

function canManageMember(
  actorRole: MembershipRole,
  targetRole: MembershipRole
): boolean {
  if (targetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return targetRole === "EDITOR" || targetRole === "VIEWER";
  return false;
}

export const FAMILY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRole = "ADMIN" | "EDITOR" | "VIEWER";

const INVITE_ROLES: InviteRole[] = ["ADMIN", "EDITOR", "VIEWER"];

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function canInviteRole(actorRole: MembershipRole, role: InviteRole): boolean {
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return role !== "ADMIN";
  return false;
}

async function requireManager(
  db: V1Db,
  familyId: string,
  actorUserId: string
): Promise<MembershipRole> {
  let auth;
  try {
    auth = await authorizeFamilyAction(
      familyId,
      { kind: "USER", userId: actorUserId },
      "MANAGE_MEMBERS",
      { db }
    );
  } catch {
    throw new InviteDomainError("FAMILY_NOT_FOUND");
  }
  if (auth.decision !== "ALLOW" || !auth.activeRole) {
    throw new InviteDomainError("FORBIDDEN");
  }
  return auth.activeRole;
}

export type CreatedInvite = {
  id: string;
  role: InviteRole;
  expiresAt: Date;
  createdAt: Date;
  /** Returned once — never persist or log. */
  rawToken: string;
};

export async function createFamilyInvite(
  familyId: string,
  actorUserId: string,
  role: string,
  options?: { db?: V1Db; now?: Date }
): Promise<CreatedInvite> {
  if (!INVITE_ROLES.includes(role as InviteRole)) {
    throw new InviteDomainError("INVALID_INPUT");
  }
  const db = dbOrDefault(options?.db);
  const actorRole = await requireManager(db, familyId, actorUserId);
  if (!canInviteRole(actorRole, role as InviteRole)) {
    throw new InviteDomainError("FORBIDDEN");
  }

  const now = options?.now ?? new Date();
  const rawToken = generateShareRawToken();
  const invite = {
    id: randomUUID(),
    familyId,
    role,
    tokenHash: hashShareToken(rawToken),
    createdByUserId: actorUserId,
    expiresAt: new Date(now.getTime() + FAMILY_INVITE_TTL_MS),
    createdAt: now,
  };
  await inviteRepo.insertInvite(db, invite);
  return {
    id: invite.id,
    role: role as InviteRole,
    expiresAt: invite.expiresAt,
    createdAt: now,
    rawToken,
  };
}

export type FamilyAccessSummary = {
  invites: Array<{ id: string; role: string; expiresAt: Date; createdAt: Date }>;
  members: Array<{
    membershipId: string;
    role: string;
    isYou: boolean;
    joinedAt: Date;
    maskedEmail: string | null;
    manageable: boolean;
  }>;
  actorRole: MembershipRole;
  /** Roles the caller may hand out. */
  invitableRoles: InviteRole[];
};

export async function getFamilyAccessSummary(
  familyId: string,
  actorUserId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<FamilyAccessSummary> {
  const db = dbOrDefault(options?.db);
  const actorRole = await requireManager(db, familyId, actorUserId);
  const now = options?.now ?? new Date();
  const invites = await inviteRepo.listOpenInvites(db, familyId, now);
  const rows = await db
    .select({
      id: familyMemberships.id,
      userId: familyMemberships.userId,
      role: familyMemberships.role,
      createdAt: familyMemberships.createdAt,
    })
    .from(familyMemberships)
    .where(
      and(
        eq(familyMemberships.familyId, familyId),
        eq(familyMemberships.status, "ACTIVE")
      )
    );
  const userIds = rows.map((r) => r.userId);
  const emailByUser = new Map<string, string | null>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({
        id: users.id,
        emailCiphertext: users.emailCiphertext,
        emailKeyVersion: users.emailKeyVersion,
      })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) {
      let masked: string | null = null;
      if (u.emailCiphertext && u.emailKeyVersion != null) {
        try {
          masked = maskEmail(
            decryptEmail(u.emailCiphertext as Buffer, u.emailKeyVersion)
          );
        } catch {
          masked = null;
        }
      }
      emailByUser.set(u.id, masked);
    }
  }
  return {
    invites,
    members: rows
      .map((r) => ({
        membershipId: r.id,
        role: r.role,
        isYou: r.userId === actorUserId,
        joinedAt: r.createdAt,
        maskedEmail: emailByUser.get(r.userId) ?? null,
        manageable: canManageMember(actorRole, r.role as MembershipRole),
      }))
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()),
    actorRole,
    invitableRoles: INVITE_ROLES.filter((r) => canInviteRole(actorRole, r)),
  };
}

/**
 * Change a non-OWNER member's role. OWNER may set ADMIN/EDITOR/VIEWER;
 * ADMIN may only set EDITOR/VIEWER on those roles.
 */
export async function updateFamilyMemberRole(
  familyId: string,
  membershipId: string,
  actorUserId: string,
  role: string,
  options?: { db?: V1Db; now?: Date }
): Promise<{ membershipId: string; role: InviteRole }> {
  if (!INVITE_ROLES.includes(role as InviteRole)) {
    throw new InviteDomainError("INVALID_INPUT");
  }
  const db = dbOrDefault(options?.db);
  const actorRole = await requireManager(db, familyId, actorUserId);
  if (!canInviteRole(actorRole, role as InviteRole)) {
    throw new InviteDomainError("FORBIDDEN");
  }
  const now = options?.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockFamilyForMutation(tx, familyId);
    const [row] = await tx
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.id, membershipId),
          eq(familyMemberships.familyId, familyId),
          eq(familyMemberships.status, "ACTIVE")
        )
      )
      .limit(1);
    if (!row) throw new InviteDomainError("INVITE_NOT_FOUND");
    if (!canManageMember(actorRole, row.role as MembershipRole)) {
      throw new InviteDomainError("FORBIDDEN");
    }
    if (row.userId === actorUserId) {
      throw new InviteDomainError("FORBIDDEN");
    }
    await tx
      .update(familyMemberships)
      .set({ role, updatedAt: now })
      .where(eq(familyMemberships.id, membershipId));
    await advanceFamilyVersion(tx, {
      familyId,
      actorUserId,
      summary: "Member role updated",
      eventType: "MEMBERSHIP_ROLE_CHANGED",
      entityType: "MEMBERSHIP",
      entityId: membershipId,
      metadataJson: { role, previousRole: row.role },
      now,
    });
    return { membershipId, role: role as InviteRole };
  });
}

/** Soft-remove (SUSPENDED) a non-OWNER member. */
export async function removeFamilyMember(
  familyId: string,
  membershipId: string,
  actorUserId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<{ membershipId: string }> {
  const db = dbOrDefault(options?.db);
  const actorRole = await requireManager(db, familyId, actorUserId);
  const now = options?.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockFamilyForMutation(tx, familyId);
    const [row] = await tx
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.id, membershipId),
          eq(familyMemberships.familyId, familyId),
          eq(familyMemberships.status, "ACTIVE")
        )
      )
      .limit(1);
    if (!row) throw new InviteDomainError("INVITE_NOT_FOUND");
    if (!canManageMember(actorRole, row.role as MembershipRole)) {
      throw new InviteDomainError("FORBIDDEN");
    }
    if (row.userId === actorUserId) {
      throw new InviteDomainError("FORBIDDEN");
    }
    await tx
      .update(familyMemberships)
      .set({ status: "SUSPENDED", updatedAt: now })
      .where(eq(familyMemberships.id, membershipId));
    await advanceFamilyVersion(tx, {
      familyId,
      actorUserId,
      summary: "Member removed",
      eventType: "MEMBERSHIP_SUSPENDED",
      entityType: "MEMBERSHIP",
      entityId: membershipId,
      metadataJson: { previousRole: row.role },
      now,
    });
    return { membershipId };
  });
}

/** Non-OWNER leaves the family (self → SUSPENDED). */
export async function leaveFamily(
  familyId: string,
  actorUserId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<{ membershipId: string }> {
  const db = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockFamilyForMutation(tx, familyId);
    const [row] = await tx
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.familyId, familyId),
          eq(familyMemberships.userId, actorUserId),
          eq(familyMemberships.status, "ACTIVE")
        )
      )
      .limit(1);
    if (!row) throw new InviteDomainError("FAMILY_NOT_FOUND");
    if (row.role === "OWNER") throw new InviteDomainError("FORBIDDEN");
    await tx
      .update(familyMemberships)
      .set({ status: "SUSPENDED", updatedAt: now })
      .where(eq(familyMemberships.id, row.id));
    await advanceFamilyVersion(tx, {
      familyId,
      actorUserId,
      summary: "Member left family",
      eventType: "MEMBERSHIP_LEFT",
      entityType: "MEMBERSHIP",
      entityId: row.id,
      metadataJson: { previousRole: row.role },
      now,
    });
    return { membershipId: row.id };
  });
}

export async function revokeFamilyInvite(
  familyId: string,
  inviteId: string,
  actorUserId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<void> {
  const db = dbOrDefault(options?.db);
  await requireManager(db, familyId, actorUserId);
  const invite = await inviteRepo.findInviteById(db, inviteId);
  if (!invite || invite.familyId !== familyId) {
    throw new InviteDomainError("INVITE_NOT_FOUND");
  }
  await inviteRepo.revokeInvite(db, inviteId, options?.now ?? new Date());
}

export type InvitePreview = {
  status: "OPEN" | "UNAVAILABLE" | "ALREADY_MEMBER";
  familyId: string | null;
  familyName: string | null;
  role: string | null;
};

/**
 * What the holder of a link is about to join. The family name is only shown
 * while the invite is still usable (or the caller is already a member).
 */
export async function previewFamilyInvite(
  rawToken: string,
  userId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<InvitePreview> {
  const db = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();
  const invite = await inviteRepo.findInviteByTokenHash(
    db,
    hashShareToken(rawToken)
  );
  if (!invite) throw new InviteDomainError("INVITE_NOT_FOUND");
  const family = await familyRepo.findActiveFamilyById(db, invite.familyId);
  const member = family
    ? await familyRepo.findActiveMembership(db, invite.familyId, userId)
    : null;
  if (member && family) {
    return {
      status: "ALREADY_MEMBER",
      familyId: family.id,
      familyName: family.displayName,
      role: member.role,
    };
  }
  if (!family || !inviteRepo.isInviteOpen(invite, now)) {
    return { status: "UNAVAILABLE", familyId: null, familyName: null, role: null };
  }
  return {
    status: "OPEN",
    familyId: family.id,
    familyName: family.displayName,
    role: invite.role,
  };
}

export type AcceptInviteResult = {
  familyId: string;
  role: string;
  alreadyMember: boolean;
};

export async function acceptFamilyInvite(
  rawToken: string,
  userId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<AcceptInviteResult> {
  const db = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();
  const tokenHash = hashShareToken(rawToken);

  return db.transaction(async (tx) => {
    const invite = await inviteRepo.lockInviteByTokenHash(tx, tokenHash);
    if (!invite) throw new InviteDomainError("INVITE_NOT_FOUND");

    const family = await lockFamilyForMutation(tx, invite.familyId);
    if (!family) throw new InviteDomainError("INVITE_UNAVAILABLE");

    const [existing] = await tx
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.familyId, invite.familyId),
          eq(familyMemberships.userId, userId)
        )
      )
      .limit(1);
    if (existing?.status === "ACTIVE") {
      return { familyId: family.id, role: existing.role, alreadyMember: true };
    }
    if (existing) throw new InviteDomainError("MEMBERSHIP_SUSPENDED");
    if (!inviteRepo.isInviteOpen(invite, now)) {
      throw new InviteDomainError("INVITE_UNAVAILABLE");
    }

    const membershipId = randomUUID();
    await familyRepo.insertMembership(tx, {
      id: membershipId,
      familyId: family.id,
      userId,
      role: invite.role as MembershipRole,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    await inviteRepo.markInviteConsumed(tx, invite.id, userId, now);
    await advanceFamilyVersion(tx, {
      familyId: family.id,
      actorUserId: userId,
      summary: "Member joined via invite",
      eventType: "MEMBER_JOINED",
      entityType: "MEMBERSHIP",
      entityId: membershipId,
      metadataJson: { role: invite.role, inviteId: invite.id },
      now,
    });
    return { familyId: family.id, role: invite.role, alreadyMember: false };
  });
}
