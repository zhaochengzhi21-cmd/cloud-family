import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { restoreRelationship } from "@/v1/services/relationshipService";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  familyId: z.string().uuid(),
  relationshipId: z.string().uuid(),
});

/**
 * POST /api/v1/families/:familyId/relationships/:relationshipId/restore
 * Undo a soft-deleted family relationship (same ACL as delete).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string; relationshipId: string } }
) {
  const started = await beginWorkspaceRequest(req, { mutation: true });
  if (!started.ok) return started.response;
  const { ctx } = started;
  const p = paramsSchema.safeParse(params);
  if (!p.success) return invalidRequest();

  try {
    const result = await restoreRelationship(
      p.data.relationshipId,
      ctx.actorContext,
      { db: ctx.db, expectedFamilyId: p.data.familyId }
    );
    return okJson({
      relationship: {
        id: result.relationship.id,
        fromPersonId: result.relationship.fromPersonId,
        toPersonId: result.relationship.toPersonId,
        relationshipType: result.relationship.relationshipType,
      },
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
