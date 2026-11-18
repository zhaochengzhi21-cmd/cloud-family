/**
 * Family export — a portable JSON copy of everything the caller can read.
 *
 * Privacy: built only from read services (family, privacy-filtered graph,
 * per-claim and per-evidence read checks), so an export never contains more
 * than the caller already sees in the workspace. Media files are referenced
 * by id only; no signed URLs are embedded.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import { getFamilyForActor } from "@/v1/services/familyService";
import { getFamilyGraph } from "@/v1/services/familyGraphService";
import {
  getClaimsForSubject,
  getClaimWithEvidence,
} from "@/v1/services/claimService";
import { mapPool } from "@/v1/util/pool";

/** Cap parallel person/claim reads so large families don't open hundreds of queries. */
const PERSON_CONCURRENCY = 6;
const CLAIM_CONCURRENCY = 4;

export const EXPORT_FORMAT = "yunzupu.family-export";
export const EXPORT_VERSION = 1;

export type FamilyExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  family: { id: string; displayName: string; surname: string | null };
  persons: Array<{
    id: string;
    preferredName: string;
    gender: string;
    livingStatus: string;
    generation: number | null;
    facts: Array<{
      id: string;
      claimType: string;
      value: unknown;
      status: string;
      originType: string;
      createdAt: string;
      reviewedAt: string | null;
      sources: Array<{ sourceId: string; relation: string }>;
    }>;
  }>;
  relationships: Array<{
    id: string;
    type: string;
    fromPersonId: string;
    toPersonId: string;
  }>;
  sources: Array<{
    id: string;
    evidenceType: string;
    title: string | null;
    description: string | null;
    sourceLocator: string | null;
    sourceDateText: string | null;
    mediaObjectId: string | null;
    createdAt: string;
  }>;
};

export async function getFamilyExport(
  familyId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db; now?: Date }
): Promise<FamilyExport> {
  const db = options?.db ?? getV1Db();
  const family = await getFamilyForActor(familyId, actorContext, { db });
  const graph = await getFamilyGraph(familyId, actorContext, { db });

  const sources = new Map<string, FamilyExport["sources"][number]>();
  const persons = await mapPool(graph.persons, PERSON_CONCURRENCY, async (person) => {
    const claims = await getClaimsForSubject(
      familyId,
      "PERSON",
      person.id,
      actorContext,
      { db }
    );
    const facts = await mapPool(claims, CLAIM_CONCURRENCY, async (claim) => {
      const bundle = await getClaimWithEvidence(claim.id, actorContext, { db });
      const links = bundle?.evidenceLinks ?? [];
      for (const { evidence: ev } of links) {
        if (!sources.has(ev.id)) {
          sources.set(ev.id, {
            id: ev.id,
            evidenceType: ev.evidenceType,
            title: ev.title,
            description: ev.description,
            sourceLocator: ev.sourceLocator,
            sourceDateText: ev.sourceDateText,
            mediaObjectId: ev.mediaObjectId,
            createdAt: ev.createdAt.toISOString(),
          });
        }
      }
      return {
        id: claim.id,
        claimType: claim.claimType,
        value: claim.value,
        status: claim.status,
        originType: claim.originType,
        createdAt: claim.createdAt.toISOString(),
        reviewedAt: claim.reviewedAt ? claim.reviewedAt.toISOString() : null,
        sources: links.map((l) => ({
          sourceId: l.evidence.id,
          relation: l.relation,
        })),
      };
    });
    return {
      id: person.id,
      preferredName: person.preferredName,
      gender: person.gender,
      livingStatus: person.livingStatus,
      generation: graph.generationByPerson[person.id] ?? null,
      facts,
    };
  });

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (options?.now ?? new Date()).toISOString(),
    family: {
      id: family.id,
      displayName: family.displayName,
      surname: family.surname,
    },
    persons,
    relationships: graph.relationships.map((r) => ({
      id: r.id,
      type: r.type,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
    })),
    sources: [...sources.values()],
  };
}
