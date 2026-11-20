import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { getFamilyMembersRoster } from "@/v1/services/familyInviteService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/** GET — active members (role + masked email). Any family member may read. */
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
    const roster = await getFamilyMembersRoster(p.data.familyId, ctx.userId, {
      db: ctx.db,
    });
    return okJson({
      members: roster.members.map((m) => ({
        membershipId: m.membershipId,
        role: m.role,
        isYou: m.isYou,
        joinedAt: m.joinedAt.toISOString(),
        maskedEmail: m.maskedEmail,
      })),
      actorRole: roster.actorRole,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
