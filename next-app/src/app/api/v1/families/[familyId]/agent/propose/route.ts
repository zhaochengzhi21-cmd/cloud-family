import { NextRequest, NextResponse } from "next/server";
import { beginWorkspaceRequest } from "@/v1/http/workspaceContext";
import { readJsonBody } from "@/v1/http/request";
import { agentProposeBodySchema } from "@/v1/http/schemas/workspace";
import { invalidRequest, mapDomainErrorToResponse } from "@/v1/http/errors";
import {
  claimDto,
  okJson,
  personDto,
  relationshipDto,
} from "@/v1/http/response";
import {
  AgentProposeError,
  proposeAgentPackage,
} from "@/v1/services/agentProposeService";
import { withIdempotency } from "@/v1/http/idempotency";
import { readClientAgent } from "@/v1/http/clientAgent";
import { privateNoStoreHeaders } from "@/v1/http/origin";
import type { ClaimDto } from "@/v1/domain/claim/types";
import type { PersonView } from "@/v1/domain/person/types";
import type { RelationshipView } from "@/v1/domain/relationship/types";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ familyId: z.string().uuid() });

function mapPersonResults(results: unknown[]) {
  return results.map((r) => {
    const row = r as {
      index: number;
      ok: boolean;
      person?: PersonView;
      reused?: boolean;
      code?: string;
      clientItemId?: string;
    };
    if (row.ok && row.person) {
      return {
        index: row.index,
        ok: true as const,
        person: personDto(row.person),
        clientItemId: row.clientItemId,
      };
    }
    return {
      index: row.index,
      ok: false as const,
      code: row.code ?? "INVALID_REQUEST",
      clientItemId: row.clientItemId,
    };
  });
}

function mapRelResults(results: unknown[]) {
  return results.map((r) => {
    const row = r as {
      index: number;
      ok: boolean;
      relationship?: RelationshipView;
      reused?: boolean;
      code?: string;
      clientItemId?: string;
    };
    if (row.ok && row.relationship) {
      return {
        index: row.index,
        ok: true as const,
        relationship: relationshipDto(row.relationship),
        reused: Boolean(row.reused),
        clientItemId: row.clientItemId,
      };
    }
    return {
      index: row.index,
      ok: false as const,
      code: row.code ?? "INVALID_REQUEST",
      clientItemId: row.clientItemId,
    };
  });
}

function mapClaimResults(results: unknown[]) {
  return results.map((r) => {
    const row = r as {
      index: number;
      ok: boolean;
      claim?: ClaimDto;
      reused?: boolean;
      code?: string;
      clientItemId?: string;
    };
    if (row.ok && row.claim) {
      return {
        index: row.index,
        ok: true as const,
        claim: claimDto(row.claim),
        reused: Boolean(row.reused),
        clientItemId: row.clientItemId,
      };
    }
    return {
      index: row.index,
      ok: false as const,
      code: row.code ?? "INVALID_REQUEST",
      clientItemId: row.clientItemId,
    };
  });
}

/**
 * POST /api/v1/families/:familyId/agent/propose
 * AI-era composite: people + edges + facts (+ optional source) in one call.
 * Facts stay 待确认. Prefer Idempotency-Key on retries.
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
  const parsed = agentProposeBodySchema.safeParse(body.value);
  if (!parsed.success) return invalidRequest();
  const clientAgent = readClientAgent(req);

  return withIdempotency({
    req,
    userId: ctx.userId,
    familyId: p.data.familyId,
    routeId: "agent.propose",
    body: parsed.data,
    run: async () => {
      try {
        const result = await proposeAgentPackage(
          {
            familyId: p.data.familyId,
            actorContext: ctx.actorContext,
            originType: parsed.data.originType,
            clientAgent,
            persons: parsed.data.persons,
            relationships: parsed.data.relationships,
            claims: parsed.data.claims,
            evidence: parsed.data.evidence,
          },
          { db: ctx.db }
        );
        return okJson(
          {
            personMap: result.personMap,
            claimMap: result.claimMap,
            persons: {
              created: result.persons.created,
              failed: result.persons.failed,
              results: mapPersonResults(result.persons.results),
            },
            relationships: {
              created: result.relationships.created,
              reused: result.relationships.reused,
              failed: result.relationships.failed,
              results: mapRelResults(result.relationships.results),
            },
            claims: {
              created: result.claims.created,
              reused: result.claims.reused,
              failed: result.claims.failed,
              results: mapClaimResults(result.claims.results),
            },
            evidence: result.evidence,
            familyVersion: result.familyVersion,
          },
          201
        );
      } catch (e) {
        if (e instanceof AgentProposeError) {
          return NextResponse.json(
            { success: false, code: e.code },
            { status: 400, headers: privateNoStoreHeaders() }
          );
        }
        return mapDomainErrorToResponse(e, {
          userId: ctx.userId,
          familyId: p.data.familyId,
          db: ctx.db,
        });
      }
    },
  });
}
