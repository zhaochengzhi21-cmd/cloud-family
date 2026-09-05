/**
 * Person Service — authorization boundary for Person mutations/reads.
 * Must call PermissionService; never expose repository directly to routes.
 */

import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { PersonDomainError } from "@/v1/domain/person/errors";
import {
  validateCreatePersonInput,
  validateUpdatePersonInput,
  assertUuid,
} from "@/v1/domain/person/validation";
import type {
  CreatePersonInput,
  CreatePersonResult,
  DeletePersonResult,
  PersonView,
  UpdatePersonInput,
  UpdatePersonResult,
} from "@/v1/domain/person/types";
import type { AccessContext } from "@/v1/domain/permission/types";
import {
  authorizeFamilyAction,
  authorizePersonAction,
  authorizePersonRead,
} from "@/v1/services/permissionService";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";
import * as personRepo from "@/v1/repositories/personRepository";
import * as relRepo from "@/v1/repositories/relationshipRepository";

import type { DbOrTx } from "@/v1/repositories/personRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function actorUserId(ctx: AccessContext): string | null {
  if (ctx.kind === "USER" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.userId;
  }
  return null;
}

function mapPermForbidden(e: unknown): never {
  if (e instanceof PermissionDomainError) {
    if (e.code === "FAMILY_NOT_FOUND") {
      throw new PersonDomainError("FAMILY_NOT_FOUND");
    }
    if (e.code === "PERSON_NOT_FOUND") {
      throw new PersonDomainError("PERSON_NOT_FOUND");
    }
    throw new PersonDomainError("FORBIDDEN");
  }
  throw e;
}

/**
 * Cannot mutate a person the actor cannot read (e.g. EDITOR vs PRIVATE).
 */
async function assertCanReadPerson(
  personId: string,
  ctx: AccessContext,
  db: DbOrTx
) {
  const read = await authorizePersonRead(personId, ctx, { db }).catch(
    mapPermForbidden
  );
  if (read.decision !== "ALLOW") {
    throw new PersonDomainError("FORBIDDEN");
  }
}

export async function getPerson(
  personId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<PersonView> {
  assertUuid(personId, "personId");
  const database = dbOrDefault(options?.db);
  const auth = await authorizePersonRead(personId, actorContext, {
    db: database,
  }).catch(mapPermForbidden);
  if (auth.decision !== "ALLOW") {
    throw new PersonDomainError("FORBIDDEN");
  }
  const person = await personRepo.findActivePersonById(database, personId);
  if (!person) throw new PersonDomainError("PERSON_NOT_FOUND");
  return person;
}

export async function createPerson(
  input: CreatePersonInput,
  options?: { db?: V1Db }
): Promise<CreatePersonResult> {
  const validated = validateCreatePersonInput(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const personId = randomUUID();
  const userId = actorUserId(input.actorContext);

  return database.transaction(async (tx) => {
    const family = await lockFamilyForMutation(tx, validated.familyId);
    if (!family) throw new PersonDomainError("FAMILY_NOT_FOUND");

    const auth = await authorizeFamilyAction(
      validated.familyId,
      input.actorContext,
      "EDIT_PERSON",
      { db: tx }
    ).catch(mapPermForbidden);
    if (auth.decision !== "ALLOW") {
      throw new PersonDomainError("FORBIDDEN");
    }

    await personRepo.insertPerson(tx, {
      id: personId,
      familyId: validated.familyId,
      preferredName: validated.preferredName,
      gender: validated.gender,
      livingStatus: validated.livingStatus,
      privacyLevel: validated.privacyLevel,
      revisionNo: 1,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId: validated.familyId,
      actorUserId: userId,
      summary: "PERSON_CREATED",
      eventType: "PERSON_CREATED",
      entityType: "PERSON",
      entityId: personId,
      metadataJson: {
        fields: ["preferredName", "gender", "livingStatus", "privacyLevel"],
      },
      now,
    });

    const person = await personRepo.findActivePersonById(tx, personId);
    if (!person) throw new Error("createPerson: missing after insert");
    return { person, familyVersion };
  });
}

export async function updatePerson(
  input: UpdatePersonInput,
  options?: { db?: V1Db }
): Promise<UpdatePersonResult> {
  const validated = validateUpdatePersonInput(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const userId = actorUserId(input.actorContext);

  return database.transaction(async (tx) => {
    const lockedPerson = await personRepo.lockActivePersonRow(
      tx,
      validated.personId
    );
    if (!lockedPerson) throw new PersonDomainError("PERSON_NOT_FOUND");

    const family = await lockFamilyForMutation(tx, lockedPerson.familyId);
    if (!family) throw new PersonDomainError("FAMILY_NOT_FOUND");

    const editAuth = await authorizePersonAction(
      validated.personId,
      input.actorContext,
      "EDIT_PERSON",
      { db: tx }
    ).catch(mapPermForbidden);
    if (editAuth.decision !== "ALLOW") {
      throw new PersonDomainError("FORBIDDEN");
    }

    // Cannot edit what you cannot read (PRIVATE vs EDITOR)
    await assertCanReadPerson(validated.personId, input.actorContext, tx);

    if (lockedPerson.revisionNo !== validated.expectedRevision) {
      throw new PersonDomainError("PERSON_VERSION_CONFLICT");
    }

    const nextPreferred =
      validated.preferredName !== undefined
        ? validated.preferredName
        : lockedPerson.preferredName;
    const nextGender =
      validated.gender !== undefined ? validated.gender : lockedPerson.gender;
    const nextLiving =
      validated.livingStatus !== undefined
        ? validated.livingStatus
        : lockedPerson.livingStatus;
    const nextPrivacy =
      validated.privacyLevel !== undefined
        ? validated.privacyLevel
        : lockedPerson.privacyLevel;

    const changedFields: string[] = [];
    if (nextPreferred !== lockedPerson.preferredName) {
      changedFields.push("preferredName");
    }
    if (nextGender !== lockedPerson.gender) changedFields.push("gender");
    if (nextLiving !== lockedPerson.livingStatus) {
      changedFields.push("livingStatus");
    }
    if (nextPrivacy !== lockedPerson.privacyLevel) {
      changedFields.push("privacyLevel");
    }

    if (changedFields.length === 0) {
      return { status: "NO_CHANGES" as const, person: lockedPerson };
    }

    const newRev = await personRepo.updatePersonConditional(tx, {
      personId: validated.personId,
      expectedRevision: validated.expectedRevision,
      preferredName: nextPreferred,
      gender: nextGender,
      livingStatus: nextLiving,
      privacyLevel: nextPrivacy,
      updatedAt: now,
    });
    if (newRev === null) {
      throw new PersonDomainError("PERSON_VERSION_CONFLICT");
    }

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId: lockedPerson.familyId,
      actorUserId: userId,
      summary: "PERSON_UPDATED",
      eventType: "PERSON_UPDATED",
      entityType: "PERSON",
      entityId: validated.personId,
      metadataJson: { changedFields },
      now,
    });

    const person = await personRepo.findActivePersonById(tx, validated.personId);
    if (!person) throw new PersonDomainError("PERSON_NOT_FOUND");
    return {
      status: "UPDATED" as const,
      person,
      familyVersion,
      changedFields,
    };
  });
}

export async function deletePerson(
  personId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<DeletePersonResult> {
  assertUuid(personId, "personId");
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const userId = actorUserId(actorContext);

  return database.transaction(async (tx) => {
    const lockedPerson = await personRepo.lockActivePersonRow(tx, personId);
    if (!lockedPerson) throw new PersonDomainError("PERSON_NOT_FOUND");

    const family = await lockFamilyForMutation(tx, lockedPerson.familyId);
    if (!family) throw new PersonDomainError("FAMILY_NOT_FOUND");

    const auth = await authorizePersonAction(
      personId,
      actorContext,
      "DELETE_PERSON",
      { db: tx }
    ).catch(mapPermForbidden);
    if (auth.decision !== "ALLOW") {
      throw new PersonDomainError("FORBIDDEN");
    }
    await assertCanReadPerson(personId, actorContext, tx);

    const ok = await personRepo.softDeletePerson(tx, personId, now);
    if (!ok) throw new PersonDomainError("PERSON_NOT_FOUND");

    const relationshipsRemovedCount =
      await relRepo.softDeleteRelationshipsForPerson(
        tx,
        lockedPerson.familyId,
        personId,
        now
      );

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId: lockedPerson.familyId,
      actorUserId: userId,
      summary: "PERSON_DELETED",
      eventType: "PERSON_DELETED",
      entityType: "PERSON",
      entityId: personId,
      metadataJson: { relationshipsRemovedCount },
      now,
    });

    return { personId, familyVersion, relationshipsRemovedCount };
  });
}
