import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { restoreEvidence } from "@/v1/services/evidenceService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  evidenceId: z.string().uuid(),
});

/**
 * POST /api/v1/families/:familyId/evidence/:evidenceId/restore
 * Undo a soft-deleted evidence source (OWNER/ADMIN).
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

  try {
    const result = await restoreEvidence(
      p.data.familyId,
      p.data.evidenceId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson({
      evidence: result.evidence,
      familyVersion: result.familyVersion,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
