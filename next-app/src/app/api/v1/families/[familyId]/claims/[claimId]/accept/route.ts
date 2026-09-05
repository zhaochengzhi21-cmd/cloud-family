import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readOptionalJsonBody } from "@/v1/http/request";
import { emptyBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { claimDto, okJson } from "@/v1/http/response";
import { acceptClaim, getClaim } from "@/v1/services/claimService";
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

  const body = await readOptionalJsonBody(req);
  if (!body.ok) return body.response;
  if (Object.keys(body.value).length > 0) {
    const parsed = emptyBodySchema.safeParse(body.value);
    if (!parsed.success) return invalidRequest();
  }

  try {
    const existing = await getClaim(p.data.claimId, ctx.actorContext, {
      db: ctx.db,
    });
    if (!existing || existing.familyId !== p.data.familyId) {
      return notFound();
    }

    const result = await acceptClaim(
      p.data.familyId,
      p.data.claimId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson({
      claim: claimDto(result.claim),
      familyVersion: result.familyVersion,
      conflictCount: result.conflictCount,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
