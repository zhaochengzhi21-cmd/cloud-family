import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { mapDomainErrorToResponse, notFound } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { previewFamilyInvite } from "@/v1/services/familyInviteService";
import { inviteTokenSchema } from "@/v1/http/schemas/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — what a signed-in holder of this invite link would join. */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const token = inviteTokenSchema.safeParse(params.token);
  if (!token.success) return notFound();

  try {
    const preview = await previewFamilyInvite(token.data, ctx.userId, {
      db: ctx.db,
    });
    return okJson({ invite: preview });
  } catch (e) {
    return mapDomainErrorToResponse(e, { readPath: true });
  }
}
