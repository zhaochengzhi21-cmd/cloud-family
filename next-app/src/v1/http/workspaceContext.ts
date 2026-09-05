/**
 * Shared Workspace route preamble: gate, session, origin.
 */

import { NextRequest, NextResponse } from "next/server";
import { getV1Db, type V1Db } from "@/db/client";
import { isV1AlphaAppEnabled } from "@/v1/http/featureGate";
import {
  requireUserAccessContext,
  type ResolvedAuthContext,
} from "@/v1/http/authContext";
import { assertMutationOrigin } from "@/v1/http/origin";
import {
  mapDomainErrorToResponse,
  notFound,
  unauthenticated,
} from "@/v1/http/errors";
import { HttpUnauthenticatedError } from "@/v1/http/authContext";
import { HttpForbiddenOriginError } from "@/v1/http/origin";

export type WorkspaceCtx = ResolvedAuthContext & { db: V1Db };

export function appGateOr404(): NextResponse | null {
  if (!isV1AlphaAppEnabled()) return notFound();
  return null;
}

export async function beginWorkspaceRequest(
  req: NextRequest,
  opts: { mutation: boolean }
): Promise<
  | { ok: true; ctx: WorkspaceCtx }
  | { ok: false; response: NextResponse }
> {
  const gated = appGateOr404();
  if (gated) return { ok: false, response: gated };

  if (opts.mutation) {
    try {
      assertMutationOrigin(req.headers.get("origin"));
    } catch (e) {
      if (e instanceof HttpForbiddenOriginError) {
        return {
          ok: false,
          response: await mapDomainErrorToResponse(e),
        };
      }
      throw e;
    }
  }

  const db = getV1Db();
  try {
    const auth = await requireUserAccessContext(req.headers.get("cookie"), {
      db,
    });
    return { ok: true, ctx: { ...auth, db } };
  } catch (e) {
    if (e instanceof HttpUnauthenticatedError) {
      return { ok: false, response: unauthenticated() };
    }
    throw e;
  }
}
