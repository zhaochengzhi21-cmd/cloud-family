import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { reviewClaimsBatchBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { claimDto, okJson } from "@/v1/http/response";
import { reviewClaimsBatch } from "@/v1/services/claimReviewBatchService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * POST /api/v1/families/:familyId/claims/review-batch
 * Human OWNER/ADMIN: accept or reject up to 20 proposed facts at once.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = reviewClaimsBatchBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "claims.reviewBatch",
    body: parsed.data,
    run: async () => {
      try {
        const result = await reviewClaimsBatch(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            action: parsed.data.action,
            claimIds: parsed.data.claimIds,
          },
          { db: ctx.db }
        );
        const status =
          result.succeeded === 0 && result.failed > 0 ? 400 : 200;
        return okJson(
          {
            action: parsed.data.action,
            results: result.results.map((r) =>
              r.ok
                ? {
                    index: r.index,
                    ok: true as const,
                    claim: claimDto(r.claim),
                  }
                : {
                    index: r.index,
                    ok: false as const,
                    claimId: r.claimId,
                    code: r.code,
                  }
            ),
            succeeded: result.succeeded,
            failed: result.failed,
            familyVersion: result.familyVersion,
          },
          status
        );
      } catch (e) {
        return mapDomainErrorToResponse(e, {
          userId: ctx.userId,
          familyId: p.data.familyId,
          db: ctx.db,
        });
      }
    },
  });
}
