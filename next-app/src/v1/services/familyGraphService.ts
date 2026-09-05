/**
 * Family Graph projection — privacy-filtered persons/edges + generation.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type {
  LivingStatus,
  PersonGender,
  PrivacyLevel,
  RelationshipType,
} from "@/db/constants";
import {
  authorizeFamilyRead,
  authorizePersonRead,
} from "@/v1/services/permissionService";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import { RelationshipDomainError } from "@/v1/domain/relationship/errors";
import { computeGenerations } from "@/v1/domain/relationship/generation";
import { isParentRelationshipType } from "@/v1/domain/relationship/types";
import { assertUuid } from "@/v1/domain/family/validation";
import * as personRepo from "@/v1/repositories/personRepository";
import * as relRepo from "@/v1/repositories/relationshipRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export type GraphPersonDto = {
  id: string;
  preferredName: string;
  gender: PersonGender;
  livingStatus: LivingStatus;
  privacyLevel: PrivacyLevel;
  revisionNo: number;
};

export type GraphRelationshipDto = {
  id: string;
  type: RelationshipType;
  fromPersonId: string;
  toPersonId: string;
};

export type FamilyGraphDto = {
  familyId: string;
  persons: GraphPersonDto[];
  relationships: GraphRelationshipDto[];
  totalGenerations: number;
  componentCount: number;
  generationByPerson: Record<string, number>;
  rootPersonIds: string[];
  generationTensionEdges: Array<{
    fromPersonId: string;
    toPersonId: string;
    parentGeneration: number;
    childGeneration: number;
  }>;
};

/**
 * Privacy-aware family graph. Hidden persons and edges touching them are omitted.
 */
export async function getFamilyGraph(
  familyId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<FamilyGraphDto> {
  assertUuid(familyId, "familyId");
  const database = dbOrDefault(options?.db);

  let familyAuth;
  try {
    familyAuth = await authorizeFamilyRead(familyId, actorContext, {
      db: database,
    });
  } catch (e) {
    if (e instanceof PermissionDomainError) {
      throw new RelationshipDomainError(
        e.code === "FAMILY_NOT_FOUND" ? "FAMILY_NOT_FOUND" : "FORBIDDEN"
      );
    }
    throw e;
  }
  if (familyAuth.decision !== "ALLOW") {
    throw new RelationshipDomainError("FORBIDDEN");
  }

  const allPersons = await personRepo.listActivePersonsByFamily(
    database,
    familyId
  );
  const visiblePersons: GraphPersonDto[] = [];
  const visibleIds = new Set<string>();

  for (const p of allPersons) {
    const read = await authorizePersonRead(p.id, actorContext, {
      db: database,
      expectedFamilyId: familyId,
    });
    if (read.decision !== "ALLOW") continue;
    visibleIds.add(p.id);
    visiblePersons.push({
      id: p.id,
      preferredName: p.preferredName,
      gender: p.gender,
      livingStatus: p.livingStatus,
      privacyLevel: p.privacyLevel,
      revisionNo: p.revisionNo,
    });
  }

  const allRels = await relRepo.listActiveAcceptedByFamily(database, familyId);
  const visibleRels: GraphRelationshipDto[] = [];
  const parentEdges: Array<{ fromPersonId: string; toPersonId: string }> = [];

  for (const r of allRels) {
    if (!visibleIds.has(r.fromPersonId) || !visibleIds.has(r.toPersonId)) {
      continue; // no side-channel leak
    }
    visibleRels.push({
      id: r.id,
      type: r.relationshipType,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
    });
    if (isParentRelationshipType(r.relationshipType)) {
      parentEdges.push({
        fromPersonId: r.fromPersonId,
        toPersonId: r.toPersonId,
      });
    }
  }

  const gen = computeGenerations(
    visiblePersons.map((p) => p.id),
    parentEdges
  );

  const generationByPerson: Record<string, number> = {};
  for (const [id, g] of gen.personGenerations) {
    generationByPerson[id] = g;
  }

  return {
    familyId,
    persons: visiblePersons,
    relationships: visibleRels,
    totalGenerations: gen.totalGenerations,
    componentCount: gen.componentCount,
    generationByPerson,
    rootPersonIds: gen.rootPersonIds,
    generationTensionEdges: gen.generationTensionEdges,
  };
}
