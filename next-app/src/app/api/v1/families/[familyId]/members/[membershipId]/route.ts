import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import {
  removeFamilyMember,
  updateFamilyMemberRole,
} from "@/v1/services/familyInviteService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

const patchBodySchema = z
  .object({
    role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
  })
  .strict();

/**
 * PATCH /api/v1/families/:familyId/members/:membershipId
 * Change a non-OWNER member's role (OWNER/ADMIN).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { familyId: string; membershipId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = patchBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "members.patch_role",
    body: { membershipId: p.data.membershipId, ...parsed.data },
    run: async () => {
      try {
        const result = await updateFamilyMemberRole(
          p.data.familyId,
          p.data.membershipId,
          ctx.userId,
          parsed.data.role,
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

/**
 * DELETE /api/v1/families/:familyId/members/:membershipId
 * Soft-remove (SUSPENDED) a non-OWNER member.
 */
export async function DELETE(
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
    routeId: "members.remove",
    body: { membershipId: p.data.membershipId },
    run: async () => {
      try {
        const result = await removeFamilyMember(
          p.data.familyId,
          p.data.membershipId,
          ctx.userId,
          { db: ctx.db }
        );
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
