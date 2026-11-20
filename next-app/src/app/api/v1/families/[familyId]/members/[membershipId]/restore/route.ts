import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { restoreFamilyMember } from "@/v1/services/familyInviteService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

/**
 * POST /api/v1/families/:familyId/members/:membershipId/restore
 * Undo a soft-removed (SUSPENDED) membership — OWNER/ADMIN.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; membershipId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "members.restore",
    body: { membershipId: p.data.membershipId },
    run: async () => {
      try {
        const result = await restoreFamilyMember(
          p.data.familyId,
          p.data.membershipId,
          ctx.userId,
          { db: ctx.db }
        );
        return okJson({ membership: result });
      } catch (e) {
        return mapDomainErrorToResponse(e, {
          userId: ctx.userId,
          familyId: p.data.familyId,
          db: ctx.db,
        });
      }
    },
  });
}
