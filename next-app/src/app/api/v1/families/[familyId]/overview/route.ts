import { NextRequest } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import { okJson } from "@/v1/http/response";
import { getFamilyGraph } from "@/v1/services/familyGraphService";
import { getClaimsForSubject } from "@/v1/services/claimService";
import { listClaimIdsWithActiveEvidence } from "@/v1/repositories/evidenceRepository";
import { mapPool } from "@/v1/util/pool";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

const PENDING_LIMIT = 30;
const UNSOURCED_LIMIT = 30;

type PersonStats = {
  proposed: number;
  accepted: number;
  conflicted: number;
  claimTypes: string[];
};

type ClaimSummary = {
  claimId: string;
  personId: string;
  claimType: string;
  status: string;
  text: string | null;
  createdAt: string;
};

/**
 * GET /api/v1/families/[familyId]/overview
 * Family-home summary. Only persons in the caller's graph are visited and each
 * claim still passes ClaimService read checks, so private data stays hidden.
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

  try {
    const graph = await getFamilyGraph(p.data.familyId, ctx.actorContext, {
      db: ctx.db,
    });

    const pending: ClaimSummary[] = [];
    const acceptedSummaries: ClaimSummary[] = [];

    const rows = await mapPool(graph.persons, 8, async (person) => {
      const claims = await getClaimsForSubject(
        p.data.familyId,
        "PERSON",
        person.id,
        ctx.actorContext,
        { db: ctx.db }
      );
      const stats: PersonStats = {
        proposed: 0,
        accepted: 0,
        conflicted: 0,
        claimTypes: [],
      };
      const pendingForPerson: ClaimSummary[] = [];
      const acceptedForPerson: ClaimSummary[] = [];
      for (const c of claims) {
        if (c.status === "REJECTED") continue;
        if (!stats.claimTypes.includes(c.claimType)) {
          stats.claimTypes.push(c.claimType);
        }
        if (c.status === "PROPOSED") stats.proposed += 1;
        else if (c.status === "ACCEPTED") stats.accepted += 1;
        else if (c.status === "CONFLICTED") stats.conflicted += 1;
        const value = c.value as { text?: unknown } | null;
        const summary: ClaimSummary = {
          claimId: c.id,
          personId: person.id,
          claimType: c.claimType,
          status: c.status,
          text: typeof value?.text === "string" ? value.text : null,
          createdAt: c.createdAt.toISOString(),
        };
        if (c.status === "PROPOSED" || c.status === "CONFLICTED") {
          pendingForPerson.push(summary);
        } else if (c.status === "ACCEPTED") {
          acceptedForPerson.push(summary);
        }
      }
      return {
        personId: person.id,
        stats,
        pendingForPerson,
        acceptedForPerson,
      };
    });

    const personStats: Record<string, PersonStats> = {};
    for (const row of rows) {
      personStats[row.personId] = row.stats;
      pending.push(...row.pendingForPerson);
      acceptedSummaries.push(...row.acceptedForPerson);
    }

    const sourcedIds = await listClaimIdsWithActiveEvidence(
      ctx.db,
      acceptedSummaries.map((c) => c.claimId)
    );
    const unsourcedAccepted = acceptedSummaries.filter(
      (c) => !sourcedIds.has(c.claimId)
    );

    pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    unsourcedAccepted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return okJson({
      overview: {
        personStats,
        pendingTotal: pending.length,
        pending: pending.slice(0, PENDING_LIMIT),
        acceptedTotal: acceptedSummaries.length,
        sourcedAcceptedTotal: sourcedIds.size,
        unsourcedAcceptedTotal: unsourcedAccepted.length,
        unsourcedAccepted: unsourcedAccepted.slice(0, UNSOURCED_LIMIT),
      },
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
