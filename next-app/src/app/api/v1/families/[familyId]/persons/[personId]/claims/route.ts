import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { claimDto, okJson } from "@/v1/http/response";
import { getClaimsForSubject } from "@/v1/services/claimService";
import { getPerson } from "@/v1/services/personService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  personId: z.string().uuid(),
});

/**
 * GET /api/v1/families/[familyId]/persons/[personId]/claims
 * Narrow list for Alpha Workspace — uses ClaimService only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string; personId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const person = await getPerson(p.data.personId, ctx.actorContext, {
      db: ctx.db,
    });
    if (person.familyId !== p.data.familyId) {
      return notFound();
    }

    const claims = await getClaimsForSubject(
      p.data.familyId,
      "PERSON",
      p.data.personId,
      ctx.actorContext,
      { db: ctx.db }
    );

    const includeRejected =
      req.nextUrl.searchParams.get("includeRejected") === "true";
    const filtered = includeRejected
      ? claims
      : claims.filter((c) => c.status !== "REJECTED");

    return okJson({
      claims: filtered.map((c) => claimDto(c)),
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}
