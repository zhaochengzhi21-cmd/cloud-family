import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { claimBundleDto, okJson } from "@/v1/http/response";
import { getClaimWithEvidence } from "@/v1/services/claimService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  claimId: z.string().uuid(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string; claimId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const bundle = await getClaimWithEvidence(p.data.claimId, ctx.actorContext, {
      db: ctx.db,
    });
    if (!bundle || bundle.claim.familyId !== p.data.familyId) {
      return notFound();
    }
    return okJson(claimBundleDto(bundle));
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}
