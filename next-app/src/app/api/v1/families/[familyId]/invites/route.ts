import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import {
  createFamilyInvite,
  getFamilyAccessSummary,
} from "@/v1/services/familyInviteService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });
const bodySchema = z.object({ role: z.enum(["ADMIN", "EDITOR", "VIEWER"]) });

/** GET — open invites, member roles, and roles the caller may invite (OWNER / ADMIN). */
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
    const summary = await getFamilyAccessSummary(p.data.familyId, ctx.userId, {
      db: ctx.db,
    });
    return okJson({
      invites: summary.invites.map((i) => ({
        id: i.id,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
      members: summary.members.map((m) => ({
        role: m.role,
        isYou: m.isYou,
        joinedAt: m.joinedAt.toISOString(),
      })),
      invitableRoles: summary.invitableRoles,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}

/** POST { role } — create a single-use invite; the raw token is returned once. */
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
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const invite = await createFamilyInvite(
      p.data.familyId,
      ctx.userId,
      parsed.data.role,
      { db: ctx.db }
    );
    return okJson(
      {
        invite: {
          id: invite.id,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        },
        token: invite.rawToken,
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
