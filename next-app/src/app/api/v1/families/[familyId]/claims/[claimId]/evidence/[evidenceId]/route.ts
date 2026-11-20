import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { unlinkEvidenceFromClaim } from "@/v1/services/evidenceService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  claimId: z.string().uuid(),
  evidenceId: z.string().uuid(),
});

/**
 * DELETE /api/v1/families/:familyId/claims/:claimId/evidence/:evidenceId
 * Detach one 资料来源 from this claim (does not delete the source).
 */
export async function DELETE(
  req: NextRequest,
  {
    params,
  }: {
    params: { familyId: string; claimId: string; evidenceId: string };
  }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "claims.evidence.unlink",
    body: {
      claimId: p.data.claimId,
      evidenceId: p.data.evidenceId,
    },
    run: async () => {
      try {
        const result = await unlinkEvidenceFromClaim(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            claimId: p.data.claimId,
            evidenceId: p.data.evidenceId,
          },
          { db: ctx.db }
        );
        return okJson({
          claimId: result.claimId,
          evidenceId: result.evidenceId,
          relation: result.relation,
          familyVersion: result.familyVersion,
        });
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
