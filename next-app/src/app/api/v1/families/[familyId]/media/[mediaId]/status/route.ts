import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { mediaStatusDto, okJson } from "@/v1/http/response";
import { getMediaUploadStatus } from "@/v1/services/mediaService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string; mediaId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: false });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const status = await getMediaUploadStatus(
      p.data.familyId,
      p.data.mediaId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson(mediaStatusDto(status));
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}
