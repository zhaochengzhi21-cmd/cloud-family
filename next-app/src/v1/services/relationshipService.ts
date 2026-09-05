/**
 * Relationship Service — authorization boundary; Relationships are sole kinship truth.
 */

import { randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { RelationshipDomainError } from "@/v1/domain/relationship/errors";
import {
  normalizeCreateRelationship,
  assertUuid,
} from "@/v1/domain/relationship/validation";
import { assertNoAncestryCycle } from "@/v1/domain/relationship/graph";
import { isParentRelationshipType } from "@/v1/domain/relationship/types";
import type {
  CreateRelationshipInput,
  CreateRelationshipResult,
  DeleteRelationshipResult,
} from "@/v1/domain/relationship/types";
import type { AccessContext } from "@/v1/domain/permission/types";
import {
  authorizeFamilyAction,
  authorizePersonRead,
} from "@/v1/services/permissionService";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import {
  advanceFamilyVersion,
  lockFamilyForMutation,
} from "@/v1/repositories/familyMutationRepository";
import * as personRepo from "@/v1/repositories/personRepository";
import * as relRepo from "@/v1/repositories/relationshipRepository";
import type { DbOrTx } from "@/v1/repositories/relationshipRepository";

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
      throw new RelationshipDomainError("FAMILY_NOT_FOUND");
    }
    if (e.code === "PERSON_NOT_FOUND") {
      throw new RelationshipDomainError("PERSON_NOT_FOUND");
    }
    throw new RelationshipDomainError("FORBIDDEN");
  }
  throw e;
}

async function assertCanReadBothPersons(
  personAId: string,
  personBId: string,
  ctx: AccessContext,
  db: DbOrTx
) {
  for (const id of [personAId, personBId]) {
    const r = await authorizePersonRead(id, ctx, { db }).catch(mapPerm);
    if (r.decision !== "ALLOW") {
      throw new RelationshipDomainError("FORBIDDEN");
    }
  }
}

export async function createRelationship(
  input: CreateRelationshipInput,
  options?: { db?: V1Db }
): Promise<CreateRelationshipResult> {
  const normalized = normalizeCreateRelationship(input);
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const userId = actorUserId(input.actorContext);
  const relationshipId = randomUUID();

  return database.transaction(async (tx) => {
    // Family-row serialization for cycle-safe concurrent mutations
    const family = await lockFamilyForMutation(tx, normalized.familyId);
    if (!family) throw new RelationshipDomainError("FAMILY_NOT_FOUND");

    const auth = await authorizeFamilyAction(
      normalized.familyId,
      input.actorContext,
      "EDIT_RELATIONSHIP",
      { db: tx }
    ).catch(mapPerm);
    if (auth.decision !== "ALLOW") {
      throw new RelationshipDomainError("FORBIDDEN");
    }

    const fromPerson = await personRepo.findPersonById(
      tx,
      normalized.fromPersonId
    );
    const toPerson = await personRepo.findPersonById(
      tx,
      normalized.toPersonId
    );
    if (!fromPerson || !toPerson) {
      throw new RelationshipDomainError("PERSON_NOT_FOUND");
    }
    if (fromPerson.deletedAt || toPerson.deletedAt) {
      throw new RelationshipDomainError("PERSON_DELETED");
    }
    if (
      fromPerson.familyId !== normalized.familyId ||
      toPerson.familyId !== normalized.familyId
    ) {
      throw new RelationshipDomainError("CROSS_FAMILY_RELATIONSHIP");
    }

    await assertCanReadBothPersons(
      normalized.fromPersonId,
      normalized.toPersonId,
      input.actorContext,
      tx
    );

    const existing = await relRepo.findActiveRelationship(
      tx,
      normalized.familyId,
      normalized.fromPersonId,
      normalized.toPersonId,
      normalized.relationshipType
    );
    if (existing) {
      throw new RelationshipDomainError("DUPLICATE_RELATIONSHIP");
    }

    if (isParentRelationshipType(normalized.relationshipType)) {
      const edges = await relRepo.listActiveParentEdges(
        tx,
        normalized.familyId
      );
      assertNoAncestryCycle(
        edges,
        normalized.fromPersonId,
        normalized.toPersonId
      );
    }

    try {
      await relRepo.insertRelationship(tx, {
        id: relationshipId,
        familyId: normalized.familyId,
        fromPersonId: normalized.fromPersonId,
        toPersonId: normalized.toPersonId,
        relationshipType: normalized.relationshipType,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      // unique violation → duplicate
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("relationships_active_edge_uq") || msg.includes("unique")) {
        throw new RelationshipDomainError("DUPLICATE_RELATIONSHIP");
      }
      throw e;
    }

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId: normalized.familyId,
      actorUserId: userId,
      summary: "RELATIONSHIP_CREATED",
      eventType: "RELATIONSHIP_CREATED",
      entityType: "RELATIONSHIP",
      entityId: relationshipId,
      metadataJson: {
        relationshipType: normalized.relationshipType,
      },
      now,
    });

    const relationship = await relRepo.findActiveRelationshipById(
      tx,
      relationshipId
    );
    if (!relationship) {
      throw new Error("createRelationship: missing after insert");
    }
    return { relationship, familyVersion };
  });
}

export async function deleteRelationship(
  relationshipId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db; expectedFamilyId?: string }
): Promise<DeleteRelationshipResult> {
  assertUuid(relationshipId, "relationshipId");
  const database = dbOrDefault(options?.db);
  const now = new Date();
  const userId = actorUserId(actorContext);

  return database.transaction(async (tx) => {
    const rel = await relRepo.findActiveRelationshipById(tx, relationshipId);
    if (!rel) throw new RelationshipDomainError("RELATIONSHIP_NOT_FOUND");
    if (
      options?.expectedFamilyId &&
      rel.familyId !== options.expectedFamilyId
    ) {
      throw new RelationshipDomainError("RELATIONSHIP_NOT_FOUND");
    }

    const family = await lockFamilyForMutation(tx, rel.familyId);
    if (!family) throw new RelationshipDomainError("FAMILY_NOT_FOUND");

    const auth = await authorizeFamilyAction(
      rel.familyId,
      actorContext,
      "EDIT_RELATIONSHIP",
      { db: tx }
    ).catch(mapPerm);
    if (auth.decision !== "ALLOW") {
      throw new RelationshipDomainError("FORBIDDEN");
    }

    await assertCanReadBothPersons(
      rel.fromPersonId,
      rel.toPersonId,
      actorContext,
      tx
    );

    const ok = await relRepo.softDeleteRelationship(tx, relationshipId, now);
    if (!ok) throw new RelationshipDomainError("RELATIONSHIP_NOT_FOUND");

    const familyVersion = await advanceFamilyVersion(tx, {
      familyId: rel.familyId,
      actorUserId: userId,
      summary: "RELATIONSHIP_DELETED",
      eventType: "RELATIONSHIP_DELETED",
      entityType: "RELATIONSHIP",
      entityId: relationshipId,
      metadataJson: {
        relationshipType: rel.relationshipType,
      },
      now,
    });

    return { relationshipId, familyVersion };
  });
}
