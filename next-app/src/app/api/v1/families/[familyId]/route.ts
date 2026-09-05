import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { patchFamilyBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { familyDto, okJson } from "@/v1/http/response";
import {
  getFamilyForActor,
  updateFamilyIdentity,
} from "@/v1/services/familyService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const family = await getFamilyForActor(p.data.familyId, ctx.actorContext, {
      db: ctx.db,
    });
    return okJson({ family: familyDto(family) });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}

export async function PATCH(
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
  const parsed = patchFamilyBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const result = await updateFamilyIdentity(
      {
        familyId: p.data.familyId,
        actorUserId: ctx.userId,
        expectedVersion: parsed.data.expectedVersion,
        displayName: parsed.data.displayName,
        surname: parsed.data.surname,
        visibility: parsed.data.visibility,
        discoveryEnabled: parsed.data.discoveryEnabled,
      },
      { db: ctx.db, actorContext: ctx.actorContext }
    );
    return okJson({
      family: familyDto(result.family),
      familyVersion: result.family.currentVersionNo,
      status: result.status,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
