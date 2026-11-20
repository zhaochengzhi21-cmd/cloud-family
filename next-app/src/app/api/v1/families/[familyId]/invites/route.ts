import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import {
  createFamilyInvite,
  getFamilyAccessSummary,
} from "@/v1/services/familyInviteService";
import { findActiveFamilyById } from "@/v1/repositories/familyRepository";
import { sendFamilyInviteEmail } from "@/v1/email/sendFamilyInviteEmail";
import { ROLE_LABEL } from "@/v1/ui/copy";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });
const bodySchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
  email: z.string().email().optional(),
});

function requestPublicOrigin(req: NextRequest): string | null {
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim();
  if (!host) return null;
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

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
        membershipId: m.membershipId,
        role: m.role,
        isYou: m.isYou,
        joinedAt: m.joinedAt.toISOString(),
        maskedEmail: m.maskedEmail,
        manageable: m.manageable,
      })),
      actorRole: summary.actorRole,
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

/** POST { role, email? } — create a single-use invite; raw token returned once. */
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

    let emailDelivery: "sent" | "skipped" | "failed" | null = null;
    if (parsed.data.email) {
      const family = await findActiveFamilyById(ctx.db, p.data.familyId);
      const origin = requestPublicOrigin(req);
      if (!family || !origin) {
        emailDelivery = "failed";
      } else {
        const roleLabel =
          ROLE_LABEL[invite.role as keyof typeof ROLE_LABEL] ?? invite.role;
        emailDelivery = await sendFamilyInviteEmail({
          to: parsed.data.email,
          familyName: family.displayName,
          roleLabel,
          inviteUrl: `${origin}/alpha/invite/${invite.rawToken}`,
          expiresAt: invite.expiresAt,
        });
      }
    }

    return okJson(
      {
        invite: {
          id: invite.id,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
        },
        token: invite.rawToken,
        emailDelivery,
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
