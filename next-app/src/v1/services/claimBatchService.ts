/**
 * Batch claim propose for AI/agent channels.
 * Partial success: one bad item does not roll back others.
 * Default onDuplicate=reuse so retries / re-extractions stay safe.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import type { ClaimType } from "@/db/constants";
import type { ClaimDto } from "@/v1/domain/claim/types";
import { ClaimDomainError, isClaimDomainError } from "@/v1/domain/claim/errors";
import { createClaim } from "@/v1/services/claimService";
import { validateCreateClaimInput } from "@/v1/domain/claim/validation";
import { computeValueFingerprint } from "@/v1/domain/claim/normalization";
import * as claimRepo from "@/v1/repositories/claimRepository";

const MAX_BATCH = 20;

export type BatchClaimItemInput = {
  subjectType: "FAMILY" | "PERSON" | "RELATIONSHIP";
  subjectId: string;
  claimType: string;
  value: unknown;
  originType?: "MANUAL" | "AI_EXTRACTION" | "IMPORT";
  confidence?: number | null;
  /** Client correlation id — echoed in results, not stored. */
  clientItemId?: string;
};

export type BatchClaimItemResult =
  | {
      index: number;
      ok: true;
      claim: ClaimDto;
      reused: boolean;
      clientItemId?: string;
    }
  | {
      index: number;
      ok: false;
      code: string;
      clientItemId?: string;
    };

export type CreateClaimsBatchResult = {
  results: BatchClaimItemResult[];
  created: number;
  reused: number;
  failed: number;
  familyVersion: number | null;
};

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function mapErrorCode(e: unknown): string {
  if (isClaimDomainError(e)) return e.code;
  return "INVALID_REQUEST";
}

export async function createClaimsBatch(
  input: {
    familyId: string;
    actorContext: AccessContext;
    claims: BatchClaimItemInput[];
    onDuplicate?: "error" | "reuse";
  },
  options?: { db?: V1Db }
): Promise<CreateClaimsBatchResult> {
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    throw new ClaimDomainError("INVALID_INPUT", "claims required");
  }
  if (input.claims.length > MAX_BATCH) {
    throw new ClaimDomainError(
      "INVALID_INPUT",
      `at most ${MAX_BATCH} claims per batch`
    );
  }

  const database = dbOrDefault(options?.db);
  const onDuplicate = input.onDuplicate ?? "reuse";
  const results: BatchClaimItemResult[] = [];
  let created = 0;
  let reused = 0;
  let failed = 0;
  let familyVersion: number | null = null;

  for (let index = 0; index < input.claims.length; index++) {
    const item = input.claims[index]!;
    const clientItemId = item.clientItemId;

    try {
      const result = await createClaim(
        {
          familyId: input.familyId,
          actorContext: input.actorContext,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          claimType: item.claimType as ClaimType,
          value: item.value,
          originType: item.originType ?? "MANUAL",
          confidence: item.confidence ?? null,
        },
        { db: database }
      );
      familyVersion = result.familyVersion;
      created += 1;
      results.push({
        index,
        ok: true,
        claim: result.claim,
        reused: false,
        clientItemId,
      });
    } catch (e) {
      if (
        onDuplicate === "reuse" &&
        isClaimDomainError(e) &&
        e.code === "DUPLICATE_ACTIVE_CLAIM"
      ) {
        try {
          const validated = validateCreateClaimInput({
            familyId: input.familyId,
            actorContext: input.actorContext,
            subjectType: item.subjectType,
            subjectId: item.subjectId,
            claimType: item.claimType as ClaimType,
            value: item.value,
            originType: item.originType ?? "MANUAL",
            confidence: item.confidence ?? null,
          });
          const fingerprint = computeValueFingerprint(
            validated.claimType,
            validated.normalized
          );
          const dup = await claimRepo.findActiveDuplicate(database, {
            familyId: input.familyId,
            subjectType: validated.subjectType,
            subjectId: validated.subjectId,
            claimType: validated.claimType,
            valueFingerprint: fingerprint,
          });
          if (!dup) throw e;
          const row = await claimRepo.findActiveClaimById(database, dup.id);
          if (!row) throw e;
          reused += 1;
          results.push({
            index,
            ok: true,
            claim: claimRepo.mapClaimDto(row),
            reused: true,
            clientItemId,
          });
          continue;
        } catch (inner) {
          failed += 1;
          results.push({
            index,
            ok: false,
            code: mapErrorCode(inner),
            clientItemId,
          });
          continue;
        }
      }
      failed += 1;
      results.push({
        index,
        ok: false,
        code: mapErrorCode(e),
        clientItemId,
      });
    }
  }

  return { results, created, reused, failed, familyVersion };
}

export { MAX_BATCH as CLAIM_BATCH_MAX };
