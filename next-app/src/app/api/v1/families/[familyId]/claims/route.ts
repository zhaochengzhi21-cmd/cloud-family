import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { createClaimBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { claimDto, okJson } from "@/v1/http/response";
import { createClaim } from "@/v1/services/claimService";
import { withIdempotency } from "@/v1/http/idempotency";
import { readClientAgent } from "@/v1/http/clientAgent";
import type { ClaimType } from "@/db/constants";
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

  // MIGRATION stays internal; agents may propose via AI_EXTRACTION / IMPORT.
  if (
    body.value.originType !== undefined &&
    body.value.originType !== "MANUAL" &&
    body.value.originType !== "AI_EXTRACTION" &&
    body.value.originType !== "IMPORT"
  ) {
    return invalidRequest();
  }
  for (const k of [
    "normalizedJson",
    "valueFingerprint",
    "status",
    "reviewedBy",
    "reviewedAt",
  ]) {
    if (k in body.value) return invalidRequest();
  }

  const parsed = createClaimBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();
  const clientAgent = readClientAgent(req);

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "claims.create",
    body: parsed.data,
    run: async () => {
      try {
        const result = await createClaim(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            subjectType: parsed.data.subjectType,
            subjectId: parsed.data.subjectId,
            claimType: parsed.data.claimType as ClaimType,
            value: parsed.data.value,
            originType: parsed.data.originType ?? "MANUAL",
            confidence: parsed.data.confidence ?? null,
            clientAgent,
          },
          { db: ctx.db }
        );
        return okJson(
          {
            claim: claimDto(result.claim),
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
