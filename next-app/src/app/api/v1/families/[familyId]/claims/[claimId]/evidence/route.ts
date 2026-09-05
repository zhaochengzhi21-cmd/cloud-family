import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { linkEvidenceBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { getClaim } from "@/v1/services/claimService";
import { linkEvidenceToClaim } from "@/v1/services/evidenceService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  claimId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; claimId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = linkEvidenceBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const claim = await getClaim(p.data.claimId, ctx.actorContext, {
      db: ctx.db,
    });
    if (!claim || claim.familyId !== p.data.familyId) {
      return notFound();
    }

    const result = await linkEvidenceToClaim(
      {
        familyId: p.data.familyId,
        actorContext: ctx.actorContext,
        claimId: p.data.claimId,
        evidenceId: parsed.data.evidenceId,
        relation: parsed.data.relation,
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
}
