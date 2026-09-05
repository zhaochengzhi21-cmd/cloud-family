import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createRelationshipBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson, relationshipDto } from "@/v1/http/response";
import { createRelationship } from "@/v1/services/relationshipService";
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
  const parsed = createRelationshipBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    // HTTP contract: from=parent / to=child → Domain personA/personB
    const result = await createRelationship(
      {
        familyId: p.data.familyId,
        actorContext: ctx.actorContext,
        personAId: parsed.data.fromPersonId,
        personBId: parsed.data.toPersonId,
        relationshipType: parsed.data.relationshipType,
      },
      { db: ctx.db }
    );
    return okJson(
      {
        relationship: relationshipDto(result.relationship),
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
