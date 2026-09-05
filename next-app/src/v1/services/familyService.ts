import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { FamilyDomainError } from "@/v1/domain/family/errors";
import {
  validateCreateFamilyInput,
  validateUpdateFamilyIdentityInput,
} from "@/v1/domain/family/validation";
import type {
  CreateFamilyInput,
  CreateFamilyResult,
  FamilyIdentity,
  UpdateFamilyIdentityInput,
  UpdateFamilyResult,
} from "@/v1/domain/family/types";
import * as repo from "@/v1/repositories/familyRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

/**
 * Trusted server-side read — no public ACL (PERMISSION task later).
 * Soft-deleted families are not returned.
 */
export async function getFamilyById(
  familyId: string,
  db?: V1Db
): Promise<FamilyIdentity | null> {
  const { assertUuid } = await import("@/v1/domain/family/validation");
  assertUuid(familyId, "familyId");
  return repo.findActiveFamilyById(dbOrDefault(db), familyId);
}

export type CreateFamilyTestHooks = {
  /** Smoke-only: fail after membership insert to prove atomic rollback. */
  failAfterMembership?: boolean;
};

/**
 * Atomically create stable Family + OWNER membership + version 1 + audit.
 * Does not create users — owner must already exist.
 */
export async function createFamily(
  input: CreateFamilyInput,
  options?: { db?: V1Db; testHooks?: CreateFamilyTestHooks }
): Promise<CreateFamilyResult> {
  const validated = validateCreateFamilyInput(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const familyId = randomUUID();
  const membershipId = randomUUID();
  const versionId = randomUUID();
  const auditId = randomUUID();

  try {
    await database.transaction(async (tx) => {
      const owner = await repo.findUserById(tx, validated.ownerUserId);
      if (!owner || owner.deletedAt) {
        throw new FamilyDomainError("OWNER_USER_NOT_FOUND");
      }

      await repo.insertFamily(tx, {
        id: familyId,
        displayName: validated.displayName,
        surname: validated.surname,
        visibility: validated.visibility,
        discoveryEnabled: validated.discoveryEnabled,
        createdByUserId: validated.ownerUserId,
        currentVersionNo: 1,
        createdAt: now,
        updatedAt: now,
      });

      await repo.insertMembership(tx, {
        id: membershipId,
        familyId,
        userId: validated.ownerUserId,
        role: "OWNER",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });

      if (options?.testHooks?.failAfterMembership) {
        throw new Error("TEST_FORCE_ROLLBACK_AFTER_MEMBERSHIP");
      }

      await repo.insertFamilyVersion(tx, {
        id: versionId,
        familyId,
        versionNo: 1,
        createdByUserId: validated.ownerUserId,
        schemaVersion: 1,
        summary: "Family created",
        createdAt: now,
      });

      await repo.insertAuditEvent(tx, {
        id: auditId,
        familyId,
        actorUserId: validated.ownerUserId,
        eventType: "FAMILY_CREATED",
        entityType: "FAMILY",
        entityId: familyId,
        metadataJson: {
          version: 1,
          fields: ["displayName", "surname", "visibility", "discoveryEnabled"],
        },
        createdAt: now,
      });
    });
  } catch (e) {
    if (e instanceof FamilyDomainError) throw e;
    if (
      e instanceof Error &&
      e.message === "TEST_FORCE_ROLLBACK_AFTER_MEMBERSHIP"
    ) {
      throw e;
    }
    throw e;
  }

  const family = await repo.findActiveFamilyById(database, familyId);
  if (!family) {
    throw new Error("createFamily: family missing after commit");
  }
  return { family };
}

/**
 * Update identity fields with optimistic concurrency.
 * familyId never changes; currentVersionNo increments on real changes.
 */
export async function updateFamilyIdentity(
  input: UpdateFamilyIdentityInput,
  options?: { db?: V1Db }
): Promise<UpdateFamilyResult> {
  const validated = validateUpdateFamilyIdentityInput(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();

  return database.transaction(async (tx) => {
    const locked = await repo.lockActiveFamilyRow(tx, validated.familyId);
    if (!locked) {
      throw new FamilyDomainError("FAMILY_NOT_FOUND");
    }

    const membership = await repo.findActiveMembership(
      tx,
      validated.familyId,
      validated.actorUserId
    );
    if (
      !membership ||
      (membership.role !== "OWNER" && membership.role !== "ADMIN")
    ) {
      throw new FamilyDomainError("FORBIDDEN");
    }

    if (locked.currentVersionNo !== validated.expectedVersion) {
      throw new FamilyDomainError("VERSION_CONFLICT");
    }

    const nextDisplayName =
      validated.displayName !== undefined
        ? validated.displayName
        : locked.displayName;
    const nextSurname =
      validated.surname !== undefined ? validated.surname : locked.surname;
    const nextVisibility =
      validated.visibility !== undefined
        ? validated.visibility
        : locked.visibility;
    const nextDiscovery =
      validated.discoveryEnabled !== undefined
        ? validated.discoveryEnabled
        : locked.discoveryEnabled;

    const changedFields: string[] = [];
    if (nextDisplayName !== locked.displayName) changedFields.push("displayName");
    if (nextSurname !== locked.surname) changedFields.push("surname");
    if (nextVisibility !== locked.visibility) changedFields.push("visibility");
    if (nextDiscovery !== locked.discoveryEnabled) {
      changedFields.push("discoveryEnabled");
    }

    if (changedFields.length === 0) {
      return { status: "NO_CHANGES" as const, family: locked };
    }

    const newVersion = await repo.updateFamilyIdentityConditional(tx, {
      familyId: validated.familyId,
      expectedVersion: validated.expectedVersion,
      displayName: nextDisplayName,
      surname: nextSurname,
      visibility: nextVisibility,
      discoveryEnabled: nextDiscovery,
      updatedAt: now,
    });

    if (newVersion === null) {
      throw new FamilyDomainError("VERSION_CONFLICT");
    }

    const { recordFamilyMutationLedger } = await import(
      "@/v1/repositories/familyMutationRepository"
    );
    await recordFamilyMutationLedger(tx, {
      familyId: validated.familyId,
      versionNo: newVersion,
      actorUserId: validated.actorUserId,
      summary: "FAMILY_IDENTITY_UPDATED",
      eventType: "FAMILY_IDENTITY_UPDATED",
      entityType: "FAMILY",
      entityId: validated.familyId,
      metadataJson: {
        fromVersion: validated.expectedVersion,
        toVersion: newVersion,
        changedFields,
        familyVersion: newVersion,
      },
      now,
    });

    const family = await repo.findActiveFamilyById(tx, validated.familyId);
    if (!family) {
      throw new FamilyDomainError("FAMILY_NOT_FOUND");
    }

    return {
      status: "UPDATED" as const,
      family,
      fromVersion: validated.expectedVersion,
      toVersion: newVersion,
      changedFields,
    };
  });
}
