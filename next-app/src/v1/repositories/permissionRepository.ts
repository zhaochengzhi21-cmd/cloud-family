import { and, eq, isNull } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import {
  families,
  familyMemberships,
  familyShareLinks,
  persons,
} from "@/db/schema";
import type {
  FamilyVisibility,
  LivingStatus,
  MembershipRole,
  MembershipStatus,
  PrivacyLevel,
} from "@/db/constants";

export type Tx = Parameters<Parameters<V1Db["transaction"]>[0]>[0];
export type DbOrTx = V1Db | Tx;

export type FamilyAccessRow = {
  id: string;
  visibility: FamilyVisibility;
  discoveryEnabled: boolean;
  deletedAt: Date | null;
};

export type MembershipAccessRow = {
  role: MembershipRole;
  status: MembershipStatus;
};

export type PersonAccessRow = {
  id: string;
  familyId: string;
  privacyLevel: PrivacyLevel;
  livingStatus: LivingStatus;
  deletedAt: Date | null;
};

export type ShareLinkRow = {
  id: string;
  familyId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

/** Load family including soft-deleted (for DENY-all when deleted). */
export async function findFamilyForAccess(
  db: DbOrTx,
  familyId: string
): Promise<FamilyAccessRow | null> {
  const [row] = await db
    .select({
      id: families.id,
      visibility: families.visibility,
      discoveryEnabled: families.discoveryEnabled,
      deletedAt: families.deletedAt,
    })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    visibility: row.visibility as FamilyVisibility,
    discoveryEnabled: row.discoveryEnabled,
    deletedAt: row.deletedAt,
  };
}

/**
 * Membership for permission — returns row even if SUSPENDED.
 * Service treats SUSPENDED as no membership.
 */
export async function findMembershipForAccess(
  db: DbOrTx,
  familyId: string,
  userId: string
): Promise<MembershipAccessRow | null> {
  const [row] = await db
    .select({
      role: familyMemberships.role,
      status: familyMemberships.status,
    })
    .from(familyMemberships)
    .where(
      and(
        eq(familyMemberships.familyId, familyId),
        eq(familyMemberships.userId, userId)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    role: row.role as MembershipRole,
    status: row.status as MembershipStatus,
  };
}

export async function findPersonForAccess(
  db: DbOrTx,
  personId: string
): Promise<PersonAccessRow | null> {
  const [row] = await db
    .select({
      id: persons.id,
      familyId: persons.familyId,
      privacyLevel: persons.privacyLevel,
      livingStatus: persons.livingStatus,
      deletedAt: persons.deletedAt,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.familyId,
    privacyLevel: row.privacyLevel as PrivacyLevel,
    livingStatus: row.livingStatus as LivingStatus,
    deletedAt: row.deletedAt,
  };
}

export async function findShareLinkByTokenHash(
  db: DbOrTx,
  tokenHash: string
): Promise<ShareLinkRow | null> {
  const [row] = await db
    .select({
      id: familyShareLinks.id,
      familyId: familyShareLinks.familyId,
      expiresAt: familyShareLinks.expiresAt,
      revokedAt: familyShareLinks.revokedAt,
    })
    .from(familyShareLinks)
    .where(eq(familyShareLinks.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function insertShareLink(
  db: DbOrTx,
  values: {
    id: string;
    familyId: string;
    createdByUserId: string;
    tokenHash: string;
    expiresAt: Date | null;
    createdAt: Date;
  }
) {
  await db.insert(familyShareLinks).values({
    id: values.id,
    familyId: values.familyId,
    createdByUserId: values.createdByUserId,
    tokenHash: values.tokenHash,
    expiresAt: values.expiresAt,
    revokedAt: null,
    createdAt: values.createdAt,
  });
}

export async function findShareLinkById(db: DbOrTx, linkId: string) {
  const [row] = await db
    .select()
    .from(familyShareLinks)
    .where(eq(familyShareLinks.id, linkId))
    .limit(1);
  return row ?? null;
}

export async function revokeShareLinkById(
  db: DbOrTx,
  linkId: string,
  revokedAt: Date
) {
  await db
    .update(familyShareLinks)
    .set({ revokedAt })
    .where(
      and(eq(familyShareLinks.id, linkId), isNull(familyShareLinks.revokedAt))
    );
}
