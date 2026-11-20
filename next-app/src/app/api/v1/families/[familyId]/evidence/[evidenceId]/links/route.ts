import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { linkEvidenceBatchBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { linkEvidenceToClaimsBatch } from "@/v1/services/evidenceLinkBatchService";
import { withIdempotency } from "@/v1/http/idempotency";
import { readClientAgent } from "@/v1/http/clientAgent";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  evidenceId: z.string().uuid(),
});

/**
 * POST /api/v1/families/:familyId/evidence/:evidenceId/links
 * AI-era: attach one 资料来源 to many claims in one call.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; evidenceId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = linkEvidenceBatchBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  // Attribution header accepted for future metadata; linking reuses claim path today.
  void readClientAgent(req);

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "evidence.links",
    body: { evidenceId: p.data.evidenceId, ...parsed.data },
    run: async () => {
      try {
        const result = await linkEvidenceToClaimsBatch(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            evidenceId: p.data.evidenceId,
            claimIds: parsed.data.claimIds,
            relation: parsed.data.relation,
            onDuplicate: parsed.data.onDuplicate,
          },
          { db: ctx.db }
        );
        const status =
          result.linked + result.reused === 0 && result.failed > 0
            ? 400
            : 201;
        return okJson(
          {
            evidenceId: p.data.evidenceId,
            results: result.results,
            linked: result.linked,
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
