import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { patchPersonBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { okJson, personDto } from "@/v1/http/response";
import {
  deletePerson,
  getPerson,
  updatePerson,
} from "@/v1/services/personService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  personId: z.string().uuid(),
});

async function assertPersonFamily(
  personFamilyId: string,
  pathFamilyId: string
): Promise<boolean> {
  return personFamilyId === pathFamilyId;
}

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
    if (!(await assertPersonFamily(person.familyId, p.data.familyId))) {
      return notFound();
    }
    return okJson({ person: personDto(person) });
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
  { params }: { params: { familyId: string; personId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = patchPersonBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    // Boundary: load via authorized get first
    const existing = await getPerson(p.data.personId, ctx.actorContext, {
      db: ctx.db,
    });
    if (existing.familyId !== p.data.familyId) return notFound();

    const result = await updatePerson(
      {
        personId: p.data.personId,
        actorContext: ctx.actorContext,
        expectedRevision: parsed.data.expectedRevision,
        preferredName: parsed.data.preferredName,
        gender: parsed.data.gender,
        livingStatus: parsed.data.livingStatus,
        privacyLevel: parsed.data.privacyLevel,
      },
      { db: ctx.db }
    );
    return okJson({
      person: personDto(result.person),
      familyVersion:
        result.status === "UPDATED" ? result.familyVersion : undefined,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: { familyId: string; personId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const existing = await getPerson(p.data.personId, ctx.actorContext, {
      db: ctx.db,
    });
    if (existing.familyId !== p.data.familyId) return notFound();

    const result = await deletePerson(
      p.data.personId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson({
      personId: result.personId,
      familyVersion: result.familyVersion,
      relationshipsRemovedCount: result.relationshipsRemovedCount,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
