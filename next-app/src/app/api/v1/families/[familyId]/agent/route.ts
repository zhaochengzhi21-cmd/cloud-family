import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { getFamilyAgentChannel } from "@/v1/services/agentChannelService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * GET /api/v1/families/:familyId/agent
 * AI-era channel: principles, role-gated capabilities, prioritized tasks.
 * Agents propose; humans confirm. Never invent sources.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const sinceRaw = req.nextUrl.searchParams.get("since");
  let since: Date | null = null;
  if (sinceRaw) {
    const d = new Date(sinceRaw);
    if (Number.isNaN(d.getTime())) return invalidRequest();
    since = d;
  }

  try {
    const channel = await getFamilyAgentChannel(
      p.data.familyId,
      ctx.actorContext,
      {
        db: ctx.db,
        limit: Number.isFinite(limit) ? limit : undefined,
        since,
      }
    );
    return okJson({ agent: channel });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}
