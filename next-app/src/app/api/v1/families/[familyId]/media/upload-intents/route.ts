import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { reserveMediaBodySchema } from "@/v1/http/schemas/media";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { mediaPendingDto, okJson } from "@/v1/http/response";
import {
  multipartRecommendedForSize,
  reserveMediaUpload,
} from "@/v1/services/mediaService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/**
 * POST /api/v1/families/[familyId]/media/upload-intents
 * Small JSON only — never accepts file bytes.
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

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  for (const k of [
    "pathname",
    "storageKey",
    "blobUrl",
    "bucket",
    "provider",
    "sha256",
    "body",
    "file",
    "data",
  ]) {
    if (k in body.value) return invalidRequest();
  }

  const parsed = reserveMediaBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  try {
    const result = await reserveMediaUpload(
      {
        familyId: p.data.familyId,
        actorContext: ctx.actorContext,
        originalFilename: parsed.data.originalFilename,
        mimeType: parsed.data.mimeType,
        byteSize: parsed.data.byteSize,
        visibility: parsed.data.visibility,
      },
      { db: ctx.db }
    );

    return okJson(
      {
        media: mediaPendingDto({
          mediaId: result.mediaId,
          status: result.status,
          mimeType: result.mimeType,
          byteSize: result.byteSize,
          visibility: result.visibility,
        }),
        upload: {
          pathname: result.pathname,
          handleUploadUrl: "/api/v1/media/client-upload",
          multipartRecommended: multipartRecommendedForSize(result.byteSize),
        },
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
