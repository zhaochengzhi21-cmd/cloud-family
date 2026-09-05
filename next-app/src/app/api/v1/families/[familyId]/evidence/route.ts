import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createEvidenceBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { evidenceDto, okJson } from "@/v1/http/response";
import { createEvidence } from "@/v1/services/evidenceService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

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
}
