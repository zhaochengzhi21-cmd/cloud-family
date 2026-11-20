import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createClaimsBatchBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { claimDto, okJson } from "@/v1/http/response";
import { createClaimsBatch } from "@/v1/services/claimBatchService";
import { withIdempotency } from "@/v1/http/idempotency";
import { readClientAgent } from "@/v1/http/clientAgent";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * POST /api/v1/families/:familyId/claims/batch
 * AI-era: propose many facts in one call. Partial success.
 * Supports Idempotency-Key for safe retries.
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

  const parsed = createClaimsBatchBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();
  const clientAgent = readClientAgent(req);

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "claims.batch",
    body: parsed.data,
    run: async () => {
      try {
        const result = await createClaimsBatch(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            claims: parsed.data.claims.map((c) => ({
              subjectType: c.subjectType,
              subjectId: c.subjectId,
              claimType: c.claimType,
              value: c.value,
              originType: c.originType,
              confidence: c.confidence,
              clientItemId: c.clientItemId,
            })),
            onDuplicate: parsed.data.onDuplicate,
            clientAgent,
          },
          { db: ctx.db }
        );
        const status =
          result.created + result.reused === 0 && result.failed > 0
            ? 400
            : 201;
        return okJson(
          {
            results: result.results.map((r) =>
              r.ok
                ? {
                    index: r.index,
                    ok: true as const,
                    claim: claimDto(r.claim),
                    reused: r.reused,
                    clientItemId: r.clientItemId,
                  }
                : {
                    index: r.index,
                    ok: false as const,
                    code: r.code,
                    clientItemId: r.clientItemId,
                  }
            ),
            created: result.created,
            reused: result.reused,
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
