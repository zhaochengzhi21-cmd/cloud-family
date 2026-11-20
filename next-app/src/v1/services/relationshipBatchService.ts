/**
 * Batch relationship create for AI/import — partial success.
 * Default onDuplicate=reuse for safe retries.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { RelationshipType } from "@/db/constants";
import type { RelationshipView } from "@/v1/domain/relationship/types";
import {
  RelationshipDomainError,
  isRelationshipDomainError,
} from "@/v1/domain/relationship/errors";
import { normalizeCreateRelationship } from "@/v1/domain/relationship/validation";
import { createRelationship } from "@/v1/services/relationshipService";
import * as relRepo from "@/v1/repositories/relationshipRepository";

const MAX_BATCH = 20;

export type BatchRelationshipItemInput = {
  fromPersonId: string;
  toPersonId: string;
  relationshipType: RelationshipType;
  clientItemId?: string;
};

export type BatchRelationshipItemResult =
  | {
      index: number;
      ok: true;
      relationship: RelationshipView;
      reused: boolean;
      clientItemId?: string;
    }
  | {
      index: number;
      ok: false;
      code: string;
      clientItemId?: string;
    };

export type CreateRelationshipsBatchResult = {
  results: BatchRelationshipItemResult[];
  created: number;
  reused: number;
  failed: number;
  familyVersion: number | null;
};

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export async function createRelationshipsBatch(
  input: {
    familyId: string;
    actorContext: AccessContext;
    relationships: BatchRelationshipItemInput[];
    onDuplicate?: "error" | "reuse";
  },
  options?: { db?: V1Db }
): Promise<CreateRelationshipsBatchResult> {
  if (
    !Array.isArray(input.relationships) ||
    input.relationships.length === 0
  ) {
    throw new RelationshipDomainError("INVALID_INPUT", "relationships required");
  }
  if (input.relationships.length > MAX_BATCH) {
    throw new RelationshipDomainError(
      "INVALID_INPUT",
      `at most ${MAX_BATCH} relationships per batch`
    );
  }

  const database = dbOrDefault(options?.db);
  const onDuplicate = input.onDuplicate ?? "reuse";
  const results: BatchRelationshipItemResult[] = [];
  let created = 0;
  let reused = 0;
  let failed = 0;
  let familyVersion: number | null = null;

  for (let index = 0; index < input.relationships.length; index++) {
    const item = input.relationships[index]!;
    try {
      const result = await createRelationship(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          personAId: item.fromPersonId,
          personBId: item.toPersonId,
          relationshipType: item.relationshipType,
        },
        { db: database }
      );
      familyVersion = result.familyVersion;
      created += 1;
      results.push({
        index,
        ok: true,
        relationship: result.relationship,
        reused: false,
        clientItemId: item.clientItemId,
      });
    } catch (e) {
      if (
        onDuplicate === "reuse" &&
        isRelationshipDomainError(e) &&
        e.code === "DUPLICATE_RELATIONSHIP"
      ) {
        try {
          const normalized = normalizeCreateRelationship({
            familyId: input.familyId,
            actorContext: input.actorContext,
            personAId: item.fromPersonId,
            personBId: item.toPersonId,
            relationshipType: item.relationshipType,
          });
          const row = await relRepo.findActiveRelationship(
            database,
            normalized.familyId,
            normalized.fromPersonId,
            normalized.toPersonId,
            normalized.relationshipType
          );
          if (!row) throw e;
          const view = await relRepo.findActiveRelationshipById(
            database,
            row.id
          );
          if (!view) throw e;
          reused += 1;
          results.push({
            index,
            ok: true,
            relationship: view,
            reused: true,
            clientItemId: item.clientItemId,
          });
          continue;
        } catch (inner) {
          failed += 1;
          results.push({
            index,
            ok: false,
            code: isRelationshipDomainError(inner)
              ? inner.code
              : "INVALID_REQUEST",
            clientItemId: item.clientItemId,
          });
          continue;
        }
      }
      failed += 1;
      results.push({
        index,
        ok: false,
        code: isRelationshipDomainError(e) ? e.code : "INVALID_REQUEST",
        clientItemId: item.clientItemId,
      });
    }
  }

  return { results, created, reused, failed, familyVersion };
}

export { MAX_BATCH as RELATIONSHIP_BATCH_MAX };
