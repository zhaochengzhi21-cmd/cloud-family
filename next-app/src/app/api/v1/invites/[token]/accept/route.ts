import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { acceptFamilyInvite } from "@/v1/services/familyInviteService";
import { inviteTokenSchema } from "@/v1/http/schemas/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — join the family with the invite's role (single use). */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const token = inviteTokenSchema.safeParse(params.token);
  if (!token.success) return notFound();

  try {
    const result = await acceptFamilyInvite(token.data, ctx.userId, {
      db: ctx.db,
    });
    return okJson({ membership: result });
  } catch (e) {
    return mapDomainErrorToResponse(e, { readPath: true });
  }
}
