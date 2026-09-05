/**
 * Session → AccessContext. Never trust body actor/role fields.
 */

import type { V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import { resolveSession } from "@/v1/services/authService";
import { isAuthDomainError } from "@/v1/domain/auth/errors";
import { readSessionTokenFromCookieHeader } from "@/v1/http/auth/cookies";

export type ResolvedAuthContext = {
  userId: string;
  actorContext: AccessContext;
};

export class HttpUnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "HttpUnauthenticatedError";
  }
}

/**
 * Resolve USER AccessContext from cf_v1_session cookie only.
 */
export async function requireUserAccessContext(
  cookieHeader: string | null,
  options?: { db?: V1Db }
): Promise<ResolvedAuthContext> {
  const raw = readSessionTokenFromCookieHeader(cookieHeader);
  if (!raw) throw new HttpUnauthenticatedError();
  try {
    const user = await resolveSession(raw, { db: options?.db });
    return {
      userId: user.id,
      actorContext: { kind: "USER", userId: user.id },
    };
  } catch (e) {
    if (isAuthDomainError(e)) throw new HttpUnauthenticatedError();
    throw e;
  }
}
