/**
 * Local/Preview only — substitutes Vercel Blob onUploadCompleted when
 * V1_BLOB_LOCAL_FINALIZE=true. Production leaves unset → 404.
 */

import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { isV1BlobLocalFinalizeEnabled } from "@/v1/http/featureGate";
import {
  invalidRequest,
  mapDomainErrorToResponse,
  notFound,
} from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { finalizeLocalPendingMedia } from "@/v1/services/mediaService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; mediaId: string } }
) {
  if (!isV1BlobLocalFinalizeEnabled()) {
    return notFound();
  }

  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const result = await finalizeLocalPendingMedia(
      p.data.familyId,
      p.data.mediaId,
      ctx.actorContext,
      { db: ctx.db }
    );
    return okJson({
      mediaId: result.mediaId,
      status: result.status === "FAILED" ? "FAILED" : "ACTIVE",
      familyVersion: result.familyVersion,
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
    });
  }
}
