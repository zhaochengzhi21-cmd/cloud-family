import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createRelationshipsBatchBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson, relationshipDto } from "@/v1/http/response";
import { createRelationshipsBatch } from "@/v1/services/relationshipBatchService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * POST /api/v1/families/:familyId/relationships/batch
 * AI-era: create up to 20 edges in one call. Partial success.
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
  const parsed = createRelationshipsBatchBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "relationships.batch",
    body: parsed.data,
    run: async () => {
      try {
        const result = await createRelationshipsBatch(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            relationships: parsed.data.relationships,
            onDuplicate: parsed.data.onDuplicate,
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
                    relationship: relationshipDto(r.relationship),
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
