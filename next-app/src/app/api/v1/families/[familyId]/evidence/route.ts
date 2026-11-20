import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createEvidenceBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { evidenceDto, okJson } from "@/v1/http/response";
import {
  createEvidence,
  listFamilyEvidence,
} from "@/v1/services/evidenceService";
import { withIdempotency } from "@/v1/http/idempotency";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

/** GET — readable family sources (for reuse and library views). */
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
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const items = await listFamilyEvidence(p.data.familyId, ctx.actorContext, {
      db: ctx.db,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return okJson({
      evidence: items.map((e) => ({
        ...evidenceDto(e),
        mimeType: e.mimeType,
        linkCount: e.linkCount,
      })),
    });
  } catch (e) {
    return mapDomainErrorToResponse(e, {
      userId: ctx.userId,
      familyId: p.data.familyId,
      db: ctx.db,
      readPath: true,
    });
  }
}

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
  if ("storageKey" in body.value || "signedUrl" in body.value) {
    return invalidRequest();
  }
  const parsed = createEvidenceBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "evidence.create",
    body: parsed.data,
    run: async () => {
      try {
        const result = await createEvidence(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            evidenceType: parsed.data.evidenceType,
            title: parsed.data.title,
            description: parsed.data.description,
            sourceLocator: parsed.data.sourceLocator,
            sourceDateText: parsed.data.sourceDateText,
            visibility: parsed.data.visibility,
            mediaObjectId: parsed.data.mediaObjectId ?? null,
          },
          { db: ctx.db }
        );
        return okJson(
          {
            evidence: evidenceDto(result.evidence),
            familyVersion: result.familyVersion,
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
    },
  });
}
