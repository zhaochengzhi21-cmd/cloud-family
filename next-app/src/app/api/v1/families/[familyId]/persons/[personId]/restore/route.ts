import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson, personDto } from "@/v1/http/response";
import { restorePerson } from "@/v1/services/personService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  personId: z.string().uuid(),
});

/**
 * POST /api/v1/families/:familyId/persons/:personId/restore
 * Undo a soft-deleted person (OWNER/ADMIN). Restores kin edges removed with that delete when known.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; personId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const result = await restorePerson(p.data.personId, ctx.actorContext, {
      db: ctx.db,
      expectedFamilyId: p.data.familyId,
    });
    return okJson({
      person: personDto(result.person),
      familyVersion: result.familyVersion,
      relationshipsRestoredCount: result.relationshipsRestoredCount,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
