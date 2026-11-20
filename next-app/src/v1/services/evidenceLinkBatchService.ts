/**
 * Link one 资料来源 to many claims — AI OCR / page-extract friendly.
 * Partial success; already-linked → reused when onDuplicate=reuse.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { ClaimEvidenceRelation } from "@/db/constants";
import {
  EvidenceDomainError,
  isEvidenceDomainError,
} from "@/v1/domain/evidence/errors";
import { linkEvidenceToClaim } from "@/v1/services/evidenceService";

const MAX_LINKS = 20;

export type BatchLinkItemResult =
  | {
      index: number;
      ok: true;
      claimId: string;
      evidenceId: string;
      relation: ClaimEvidenceRelation;
      reused: boolean;
    }
  | {
      index: number;
      ok: false;
      claimId: string;
      code: string;
    };

export type LinkEvidenceBatchResult = {
  results: BatchLinkItemResult[];
  linked: number;
  reused: number;
  failed: number;
  familyVersion: number | null;
};

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export async function linkEvidenceToClaimsBatch(
  input: {
    familyId: string;
    actorContext: AccessContext;
    evidenceId: string;
    claimIds: string[];
    relation?: ClaimEvidenceRelation;
    onDuplicate?: "error" | "reuse";
  },
  options?: { db?: V1Db }
): Promise<LinkEvidenceBatchResult> {
  if (!Array.isArray(input.claimIds) || input.claimIds.length === 0) {
    throw new EvidenceDomainError("INVALID_INPUT", "claimIds required");
  }
  if (input.claimIds.length > MAX_LINKS) {
    throw new EvidenceDomainError(
      "INVALID_INPUT",
      `at most ${MAX_LINKS} claim links per batch`
    );
  }

  const database = dbOrDefault(options?.db);
  const relation = input.relation ?? "SUPPORTS";
  const onDuplicate = input.onDuplicate ?? "reuse";
  const results: BatchLinkItemResult[] = [];
  let linked = 0;
  let reused = 0;
  let failed = 0;
  let familyVersion: number | null = null;

  for (let index = 0; index < input.claimIds.length; index++) {
    const claimId = input.claimIds[index]!;
    try {
      const result = await linkEvidenceToClaim(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          claimId,
          evidenceId: input.evidenceId,
          relation,
        },
        { db: database }
      );
      familyVersion = result.familyVersion;
      linked += 1;
      results.push({
        index,
        ok: true,
        claimId: result.claimId,
        evidenceId: result.evidenceId,
        relation: result.relation,
        reused: false,
      });
    } catch (e) {
      if (
        onDuplicate === "reuse" &&
        isEvidenceDomainError(e) &&
        e.code === "EVIDENCE_ALREADY_LINKED"
      ) {
        reused += 1;
        results.push({
          index,
          ok: true,
          claimId,
          evidenceId: input.evidenceId,
          relation,
          reused: true,
        });
        continue;
      }
      failed += 1;
      results.push({
        index,
        ok: false,
        claimId,
        code: isEvidenceDomainError(e) ? e.code : "INVALID_REQUEST",
      });
    }
  }

  return { results, linked, reused, failed, familyVersion };
}

export { MAX_LINKS as EVIDENCE_LINK_BATCH_MAX };
