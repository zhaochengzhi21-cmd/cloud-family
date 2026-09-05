import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { deleteEvidence } from "@/v1/services/evidenceService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  evidenceId: z.string().uuid(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: { familyId: string; evidenceId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const result = await deleteEvidence(
      p.data.familyId,
      p.data.evidenceId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson({
      evidenceId: result.evidenceId,
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
