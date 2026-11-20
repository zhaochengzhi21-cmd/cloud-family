import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { leaveFamily } from "@/v1/services/familyInviteService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * POST /api/v1/families/:familyId/members/me/leave
 * Non-OWNER leaves the family (self → SUSPENDED).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string } }
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
    routeId: "members.leave",
    body: {},
    run: async () => {
      try {
        const result = await leaveFamily(p.data.familyId, ctx.userId, {
          db: ctx.db,
        });
        return okJson(result);
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
