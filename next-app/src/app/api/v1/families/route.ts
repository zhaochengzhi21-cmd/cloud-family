import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createFamilyBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { familyDto, familyListItemDto, okJson } from "@/v1/http/response";
import {
  createFamily,
  listMyFamilies,
} from "@/v1/services/familyService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  try {
    const items = await listMyFamilies(ctx.userId, { db: ctx.db });
    return okJson({
      families: items.map((i) => familyListItemDto(i.family, i.role)),
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      db: ctx.db,
      readPath: true,
    });
  }
}

export async function POST(req: NextRequest) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = createFamilyBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const result = await createFamily(
      {
        ownerUserId: ctx.userId,
        displayName: parsed.data.displayName,
        surname: parsed.data.surname,
        visibility: parsed.data.visibility ?? "PRIVATE",
        discoveryEnabled: parsed.data.discoveryEnabled ?? false,
      },
      { db: ctx.db }
    );
    return okJson({ family: familyDto(result.family) }, 201);
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      db: ctx.db,
    });
  }
}
