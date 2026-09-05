import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createPersonBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson, personDto } from "@/v1/http/response";
import { createPerson } from "@/v1/services/personService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

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
  const parsed = createPersonBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const result = await createPerson(
      {
        familyId: p.data.familyId,
        actorContext: ctx.actorContext,
        preferredName: parsed.data.preferredName,
        gender: parsed.data.gender,
        livingStatus: parsed.data.livingStatus,
        privacyLevel: parsed.data.privacyLevel,
      },
      { db: ctx.db }
    );
    return okJson(
      {
        person: personDto(result.person),
        familyVersion: result.familyVersion,
      },
      201
    );
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
