/**
 * Composite AI propose package — one OCR/page extract → people, edges,
 * facts, and optional 资料来源. Always leaves facts as 待确认.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { EvidenceType, RelationshipType } from "@/db/constants";
import { createPersonsBatch } from "@/v1/services/personBatchService";
import { createRelationshipsBatch } from "@/v1/services/relationshipBatchService";
import { createClaimsBatch } from "@/v1/services/claimBatchService";
import { createEvidence } from "@/v1/services/evidenceService";
import { linkEvidenceToClaimsBatch } from "@/v1/services/evidenceLinkBatchService";

export type ProposePersonItem = {
  preferredName: string;
  gender?: "MALE" | "FEMALE" | "UNKNOWN" | "OTHER";
  livingStatus?: "LIVING" | "DECEASED" | "UNKNOWN";
  privacyLevel?: "INHERIT" | "PRIVATE" | "FAMILY" | "PUBLIC";
  clientItemId?: string;
};

export type ProposeRelationshipItem = {
  fromPersonId?: string;
  toPersonId?: string;
  fromClientItemId?: string;
  toClientItemId?: string;
  relationshipType: RelationshipType;
  clientItemId?: string;
};

export type ProposeClaimItem = {
  subjectId?: string;
  subjectClientItemId?: string;
  claimType: string;
  value: { text: string; narrator?: string | null };
  confidence?: number | null;
  clientItemId?: string;
};

export type ProposeEvidenceItem = {
  evidenceType: EvidenceType;
  title?: string | null;
  description?: string | null;
  sourceLocator?: string | null;
  sourceDateText?: string | null;
  claimClientItemIds?: string[];
  claimIds?: string[];
};

export type ProposePackageInput = {
  familyId: string;
  actorContext: AccessContext;
  originType?: "AI_EXTRACTION" | "IMPORT";
  clientAgent?: string | null;
  persons?: ProposePersonItem[];
  relationships?: ProposeRelationshipItem[];
  claims?: ProposeClaimItem[];
  evidence?: ProposeEvidenceItem | null;
};

export type ProposePackageResult = {
  personMap: Record<string, string>;
  claimMap: Record<string, string>;
  persons: {
    created: number;
    failed: number;
    results: unknown[];
  };
  relationships: {
    created: number;
    reused: number;
    failed: number;
    results: unknown[];
  };
  claims: {
    created: number;
    reused: number;
    failed: number;
    results: unknown[];
  };
  evidence: {
    evidenceId: string | null;
    linked: number;
    reused: number;
    failed: number;
  };
  familyVersion: number | null;
};

export class AgentProposeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AgentProposeError";
    this.code = code;
  }
}

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export async function proposeAgentPackage(
  input: ProposePackageInput,
  options?: { db?: V1Db }
): Promise<ProposePackageResult> {
  const persons = input.persons ?? [];
  const relationships = input.relationships ?? [];
  const claims = input.claims ?? [];
  const hasEvidence = Boolean(input.evidence);
  if (
    persons.length === 0 &&
    relationships.length === 0 &&
    claims.length === 0 &&
    !hasEvidence
  ) {
    throw new AgentProposeError("EMPTY_PACKAGE");
  }

  const database = dbOrDefault(options?.db);
  const originType = input.originType ?? "AI_EXTRACTION";
  const personMap: Record<string, string> = {};
  const claimMap: Record<string, string> = {};
  let familyVersion: number | null = null;

  let personSection: ProposePackageResult["persons"] = {
    created: 0,
    failed: 0,
    results: [],
  };
  if (persons.length > 0) {
    const batch = await createPersonsBatch(
      {
        familyId: input.familyId,
        actorContext: input.actorContext,
        persons,
      },
      { db: database }
    );
    familyVersion = batch.familyVersion ?? familyVersion;
    personSection = {
      created: batch.created,
      failed: batch.failed,
      results: batch.results,
    };
    for (const r of batch.results) {
      if (r.ok && r.clientItemId) {
        personMap[r.clientItemId] = r.person.id;
      }
    }
  }

  let relationshipSection: ProposePackageResult["relationships"] = {
    created: 0,
    reused: 0,
    failed: 0,
    results: [],
  };
  if (relationships.length > 0) {
    const results: unknown[] = new Array(relationships.length);
    const toCreate: Array<{
      origIndex: number;
      fromPersonId: string;
      toPersonId: string;
      relationshipType: RelationshipType;
      clientItemId?: string;
    }> = [];
    let failed = 0;

    relationships.forEach((item, index) => {
      const from =
        item.fromPersonId ??
        (item.fromClientItemId
          ? personMap[item.fromClientItemId]
          : undefined);
      const to =
        item.toPersonId ??
        (item.toClientItemId ? personMap[item.toClientItemId] : undefined);
      if (!from || !to) {
        failed += 1;
        results[index] = {
          index,
          ok: false,
          code: "UNRESOLVED_PERSON_REF",
          clientItemId: item.clientItemId,
        };
        return;
      }
      toCreate.push({
        origIndex: index,
        fromPersonId: from,
        toPersonId: to,
        relationshipType: item.relationshipType,
        clientItemId: item.clientItemId,
      });
    });

    let created = 0;
    let reused = 0;
    if (toCreate.length > 0) {
      const batch = await createRelationshipsBatch(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          relationships: toCreate.map(
            ({ fromPersonId, toPersonId, relationshipType, clientItemId }) => ({
              fromPersonId,
              toPersonId,
              relationshipType,
              clientItemId,
            })
          ),
          onDuplicate: "reuse",
        },
        { db: database }
      );
      familyVersion = batch.familyVersion ?? familyVersion;
      created = batch.created;
      reused = batch.reused;
      failed += batch.failed;
      batch.results.forEach((r, i) => {
        const orig = toCreate[i]!.origIndex;
        results[orig] = { ...r, index: orig };
      });
    }
    relationshipSection = {
      created,
      reused,
      failed,
      results: results.filter((r) => r !== undefined),
    };
  }

  let claimSection: ProposePackageResult["claims"] = {
    created: 0,
    reused: 0,
    failed: 0,
    results: [],
  };
  if (claims.length > 0) {
    const results: unknown[] = new Array(claims.length);
    const toCreate: Array<{
      origIndex: number;
      subjectId: string;
      claimType: string;
      value: unknown;
      clientItemId?: string;
      confidence?: number | null;
    }> = [];
    let failed = 0;

    claims.forEach((item, index) => {
      const subjectId =
        item.subjectId ??
        (item.subjectClientItemId
          ? personMap[item.subjectClientItemId]
          : undefined);
      if (!subjectId) {
        failed += 1;
        results[index] = {
          index,
          ok: false,
          code: "UNRESOLVED_PERSON_REF",
          clientItemId: item.clientItemId,
        };
        return;
      }
      toCreate.push({
        origIndex: index,
        subjectId,
        claimType: item.claimType,
        value: item.value,
        clientItemId: item.clientItemId,
        confidence: item.confidence,
      });
    });

    let created = 0;
    let reused = 0;
    if (toCreate.length > 0) {
      const batch = await createClaimsBatch(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          claims: toCreate.map((c) => ({
            subjectType: "PERSON" as const,
            subjectId: c.subjectId,
            claimType: c.claimType,
            value: c.value,
            originType,
            confidence: c.confidence ?? null,
            clientItemId: c.clientItemId,
          })),
          onDuplicate: "reuse",
          clientAgent: input.clientAgent,
        },
        { db: database }
      );
      familyVersion = batch.familyVersion ?? familyVersion;
      created = batch.created;
      reused = batch.reused;
      failed += batch.failed;
      batch.results.forEach((r, i) => {
        const orig = toCreate[i]!.origIndex;
        results[orig] = { ...r, index: orig };
        if (r.ok && r.clientItemId) {
          claimMap[r.clientItemId] = r.claim.id;
        }
      });
    }
    claimSection = {
      created,
      reused,
      failed,
      results: results.filter((r) => r !== undefined),
    };
  }

  let evidenceSection: ProposePackageResult["evidence"] = {
    evidenceId: null,
    linked: 0,
    reused: 0,
    failed: 0,
  };
  if (input.evidence) {
    const ev = await createEvidence(
      {
        familyId: input.familyId,
        actorContext: input.actorContext,
        evidenceType: input.evidence.evidenceType,
        title: input.evidence.title,
        description: input.evidence.description,
        sourceLocator: input.evidence.sourceLocator,
        sourceDateText: input.evidence.sourceDateText,
        visibility: "FAMILY",
      },
      { db: database }
    );
    familyVersion = ev.familyVersion;
    evidenceSection.evidenceId = ev.evidence.id;

    const linkIds = new Set<string>();
    for (const id of input.evidence.claimIds ?? []) linkIds.add(id);
    for (const cid of input.evidence.claimClientItemIds ?? []) {
      const id = claimMap[cid];
      if (id) linkIds.add(id);
    }
    if (
      linkIds.size === 0 &&
      !input.evidence.claimIds?.length &&
      !input.evidence.claimClientItemIds?.length
    ) {
      for (const id of Object.values(claimMap)) linkIds.add(id);
      for (const r of claimSection.results) {
        const row = r as { ok?: boolean; claim?: { id: string } };
        if (row.ok && row.claim?.id) linkIds.add(row.claim.id);
      }
    }

    if (linkIds.size > 0) {
      const links = await linkEvidenceToClaimsBatch(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          evidenceId: ev.evidence.id,
          claimIds: [...linkIds],
          relation: "SUPPORTS",
          onDuplicate: "reuse",
        },
        { db: database }
      );
      familyVersion = links.familyVersion ?? familyVersion;
      evidenceSection.linked = links.linked;
      evidenceSection.reused = links.reused;
      evidenceSection.failed = links.failed;
    }
  }

  return {
    personMap,
    claimMap,
    persons: personSection,
    relationships: relationshipSection,
    claims: claimSection,
    evidence: evidenceSection,
    familyVersion,
  };
}
