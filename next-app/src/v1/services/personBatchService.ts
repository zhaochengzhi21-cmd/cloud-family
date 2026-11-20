/**
 * Batch person create for AI/import — partial success per item.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { PersonView } from "@/v1/domain/person/types";
import {
  PersonDomainError,
  isPersonDomainError,
} from "@/v1/domain/person/errors";
import { createPerson } from "@/v1/services/personService";

const MAX_BATCH = 20;

export type BatchPersonItemInput = {
  preferredName: string;
  gender?: "MALE" | "FEMALE" | "UNKNOWN" | "OTHER";
  livingStatus?: "LIVING" | "DECEASED" | "UNKNOWN";
  privacyLevel?: "INHERIT" | "PRIVATE" | "FAMILY" | "PUBLIC";
  clientItemId?: string;
};

export type BatchPersonItemResult =
  | {
      index: number;
      ok: true;
      person: PersonView;
      clientItemId?: string;
    }
  | {
      index: number;
      ok: false;
      code: string;
      clientItemId?: string;
    };

export type CreatePersonsBatchResult = {
  results: BatchPersonItemResult[];
  created: number;
  failed: number;
  familyVersion: number | null;
};

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export async function createPersonsBatch(
  input: {
    familyId: string;
    actorContext: AccessContext;
    persons: BatchPersonItemInput[];
  },
  options?: { db?: V1Db }
): Promise<CreatePersonsBatchResult> {
  if (!Array.isArray(input.persons) || input.persons.length === 0) {
    throw new PersonDomainError("INVALID_INPUT", "persons required");
  }
  if (input.persons.length > MAX_BATCH) {
    throw new PersonDomainError(
      "INVALID_INPUT",
      `at most ${MAX_BATCH} persons per batch`
    );
  }

  const database = dbOrDefault(options?.db);
  const results: BatchPersonItemResult[] = [];
  let created = 0;
  let failed = 0;
  let familyVersion: number | null = null;

  for (let index = 0; index < input.persons.length; index++) {
    const item = input.persons[index]!;
    try {
      const result = await createPerson(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          preferredName: item.preferredName,
          gender: item.gender,
          livingStatus: item.livingStatus,
          privacyLevel: item.privacyLevel,
        },
        { db: database }
      );
      familyVersion = result.familyVersion;
      created += 1;
      results.push({
        index,
        ok: true,
        person: result.person,
        clientItemId: item.clientItemId,
      });
    } catch (e) {
      failed += 1;
      results.push({
        index,
        ok: false,
        code: isPersonDomainError(e) ? e.code : "INVALID_REQUEST",
        clientItemId: item.clientItemId,
      });
    }
  }

  return { results, created, failed, familyVersion };
}

export { MAX_BATCH as PERSON_BATCH_MAX };
