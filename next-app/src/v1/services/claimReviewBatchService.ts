/**
 * Batch human review — confirm or decline many proposed facts at once
 * (typical after an AI /agent/propose dump).
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { ClaimDto } from "@/v1/domain/claim/types";
import { ClaimDomainError, isClaimDomainError } from "@/v1/domain/claim/errors";
import { acceptClaim, rejectClaim } from "@/v1/services/claimService";

const MAX_BATCH = 20;

export type BatchReviewItemResult =
  | {
      index: number;
      ok: true;
      claim: ClaimDto;
    }
  | {
      index: number;
      ok: false;
      claimId: string;
      code: string;
    };

export type ReviewClaimsBatchResult = {
  results: BatchReviewItemResult[];
  succeeded: number;
  failed: number;
  familyVersion: number | null;
};

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export async function reviewClaimsBatch(
  input: {
    familyId: string;
    actorContext: AccessContext;
    action: "accept" | "reject";
    claimIds: string[];
  },
  options?: { db?: V1Db }
): Promise<ReviewClaimsBatchResult> {
  if (!Array.isArray(input.claimIds) || input.claimIds.length === 0) {
    throw new ClaimDomainError("INVALID_INPUT", "claimIds required");
  }
  if (input.claimIds.length > MAX_BATCH) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      `at most ${MAX_BATCH} claims per review batch`
    );
  }

  const database = dbOrDefault(options?.db);
  const results: BatchReviewItemResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let familyVersion: number | null = null;

  for (let index = 0; index < input.claimIds.length; index++) {
    const claimId = input.claimIds[index]!;
    try {
      const result =
        input.action === "accept"
          ? await acceptClaim(
              input.familyId,
              claimId,
              input.actorContext,
              { db: database }
            )
          : await rejectClaim(
              input.familyId,
              claimId,
              input.actorContext,
              { db: database }
            );
      familyVersion = result.familyVersion;
      succeeded += 1;
      results.push({ index, ok: true, claim: result.claim });
    } catch (e) {
      failed += 1;
      results.push({
        index,
        ok: false,
        claimId,
        code: isClaimDomainError(e) ? e.code : "INVALID_REQUEST",
      });
    }
  }

  return { results, succeeded, failed, familyVersion };
}

export { MAX_BATCH as CLAIM_REVIEW_BATCH_MAX };
