/**
 * Injectable V1 Auth HTTP handlers — Closed Alpha invite-gated.
 * Public responses never enumerate user/invite state.
 */

import { randomUUID } from "crypto";
import type { V1Db } from "@/db/client";
import { getV1Db } from "@/db/client";
import { AuthDomainError, isAuthDomainError } from "@/v1/domain/auth/errors";
import { normalizeEmail } from "@/v1/domain/auth/email";
import { computeEmailLookupHash } from "@/v1/domain/auth/crypto";
import type { OtpDeliveryAdapter } from "@/v1/domain/auth/delivery";
import { InMemoryOtpDeliveryAdapter } from "@/v1/domain/auth/delivery";
import {
  createAuthChallenge,
  isOtpSendAllowed,
  verifyAuthChallenge,
  resolveSession,
  revokeSession,
} from "@/v1/services/authService";
import { resolveValidInviteForEmail } from "@/v1/services/alphaInviteService";
import * as authRepo from "@/v1/repositories/authRepository";
import {
  isAllowedOrigin,
  isV1AlphaAuthEnabled,
  noStoreHeaders,
} from "@/v1/http/auth/config";
import {
  isV1AlphaAppEnabled,
  isV1AlphaUiEnabled,
} from "@/v1/http/featureGate";
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  readSessionTokenFromCookieHeader,
} from "@/v1/http/auth/cookies";
import { createResendOtpDeliveryAdapter } from "@/v1/email/resendOtpDeliveryAdapter";
import { isResendConfigured } from "@/v1/email/config";

/** Session resolve/logout for Alpha Workspace when APP/UI is on (OTP still AUTH-gated). */
function isV1SessionHttpEnabled(): boolean {
  return (
    isV1AlphaAuthEnabled() ||
    isV1AlphaAppEnabled() ||
    isV1AlphaUiEnabled()
  );
}

export type AuthHttpRequest = {
  method: string;
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
};

export type AuthHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  /** Set-Cookie values (may be multiple) */
  cookies: string[];
};

export type AuthHttpDeps = {
  db: V1Db;
  delivery: OtpDeliveryAdapter;
  now: () => Date;
  secureCookie?: boolean;
};

export function defaultAuthHttpDeps(
  overrides?: Partial<AuthHttpDeps>
): AuthHttpDeps {
  const delivery =
    overrides?.delivery ??
    (isResendConfigured()
      ? createResendOtpDeliveryAdapter()
      : new InMemoryOtpDeliveryAdapter());
  return {
    db: overrides?.db ?? getV1Db(),
    delivery,
    now: overrides?.now ?? (() => new Date()),
    secureCookie: overrides?.secureCookie,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  cookies: string[] = []
): AuthHttpResponse {
  return {
    status,
    headers: noStoreHeaders(),
    body,
    cookies,
  };
}

function featureDisabled(): AuthHttpResponse {
  return jsonResponse(404, { success: false, code: "NOT_FOUND" });
}

function originDenied(): AuthHttpResponse {
  return jsonResponse(403, { success: false, code: "FORBIDDEN" });
}

function requireMutationOrigin(req: AuthHttpRequest): AuthHttpResponse | null {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return originDenied();
  return null;
}

const BODY_MAX = 4096;

async function readJsonObject(
  req: AuthHttpRequest
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: AuthHttpResponse }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, code: "BAD_REQUEST" }),
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, code: "BAD_REQUEST" }),
    };
  }
  const size = JSON.stringify(raw).length;
  if (size > BODY_MAX) {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, code: "BAD_REQUEST" }),
    };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

/**
 * POST /api/v1/auth/request-code
 * Always 202 for parseable requests (enumeration resistance).
 */
export async function handleRequestCode(
  req: AuthHttpRequest,
  deps: AuthHttpDeps
): Promise<AuthHttpResponse> {
  if (!isV1AlphaAuthEnabled()) return featureDisabled();
  const originBlock = requireMutationOrigin(req);
  if (originBlock) return originBlock;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  const emailRaw = parsed.value.email;
  const inviteToken =
    typeof parsed.value.inviteToken === "string"
      ? parsed.value.inviteToken
      : undefined;

  // Malformed email → still generic 202 with fake id (not 400) for enumeration?
  // Spec: only non-JSON / structure severe → 400. Invalid email format can be 202 fake.
  if (typeof emailRaw !== "string") {
    return jsonResponse(400, { success: false, code: "BAD_REQUEST" });
  }

  let canonical: string;
  try {
    canonical = normalizeEmail(emailRaw);
  } catch {
    return jsonResponse(202, {
      success: true,
      challengeId: randomUUID(),
    });
  }

  const lookupHash = computeEmailLookupHash(canonical);
  const now = deps.now();
  const existing = await authRepo.findUserByLookupHash(deps.db, lookupHash);
  const existingActive = existing && !existing.deletedAt;

  let alphaInviteId: string | null = null;
  if (existingActive) {
    // Existing user: invite optional / ignored
    alphaInviteId = null;
  } else {
    const resolved = await resolveValidInviteForEmail(inviteToken, lookupHash, {
      db: deps.db,
      now,
    });
    if (!resolved) {
      // Fake challenge — no email, no DB
      return jsonResponse(202, {
        success: true,
        challengeId: randomUUID(),
      });
    }
    alphaInviteId = resolved.inviteId;
  }

  const allowed = await isOtpSendAllowed(lookupHash, {
    db: deps.db,
    now,
  });
  if (!allowed) {
    return jsonResponse(202, {
      success: true,
      challengeId: randomUUID(),
    });
  }

  try {
    const result = await createAuthChallenge(canonical, deps.delivery, {
      db: deps.db,
      alphaInviteId,
      now,
    });
    return jsonResponse(202, {
      success: true,
      challengeId: result.challengeId,
    });
  } catch (e) {
    // Delivery failure → generic 202 (no leak)
    void e;
    return jsonResponse(202, {
      success: true,
      challengeId: randomUUID(),
    });
  }
}

/**
 * POST /api/v1/auth/verify
 */
export async function handleVerify(
  req: AuthHttpRequest,
  deps: AuthHttpDeps
): Promise<AuthHttpResponse> {
  if (!isV1AlphaAuthEnabled()) return featureDisabled();
  const originBlock = requireMutationOrigin(req);
  if (originBlock) return originBlock;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  const challengeId = parsed.value.challengeId;
  const code = parsed.value.code;
  if (typeof challengeId !== "string" || typeof code !== "string") {
    return jsonResponse(400, { success: false, code: "BAD_REQUEST" });
  }

  try {
    const result = await verifyAuthChallenge(challengeId, code, {
      db: deps.db,
      now: deps.now(),
    });
    const cookie = buildSessionCookieHeader(
      result.sessionToken,
      result.sessionExpiresAt,
      { secure: deps.secureCookie }
    );
    return {
      status: 200,
      headers: noStoreHeaders(),
      body: {
        success: true,
        user: { id: result.user.id },
      },
      cookies: [cookie],
    };
  } catch (e) {
    if (isAuthDomainError(e)) {
      return jsonResponse(401, {
        success: false,
        code: "INVALID_OR_EXPIRED_CODE",
      });
    }
    return jsonResponse(401, {
      success: false,
      code: "INVALID_OR_EXPIRED_CODE",
    });
  }
}

/**
 * GET /api/v1/auth/me
 */
export async function handleMe(
  req: AuthHttpRequest,
  deps: AuthHttpDeps
): Promise<AuthHttpResponse> {
  if (!isV1SessionHttpEnabled()) return featureDisabled();

  const raw = readSessionTokenFromCookieHeader(req.headers.get("cookie"));
  if (!raw) {
    return jsonResponse(401, { success: false, code: "UNAUTHENTICATED" });
  }
  try {
    const user = await resolveSession(raw, { db: deps.db });
    return jsonResponse(200, {
      authenticated: true,
      user: { id: user.id },
    });
  } catch {
    return jsonResponse(401, { success: false, code: "UNAUTHENTICATED" });
  }
}

/**
 * POST /api/v1/auth/logout
 */
export async function handleLogout(
  req: AuthHttpRequest,
  deps: AuthHttpDeps
): Promise<AuthHttpResponse> {
  if (!isV1SessionHttpEnabled()) return featureDisabled();
  const originBlock = requireMutationOrigin(req);
  if (originBlock) return originBlock;

  const raw = readSessionTokenFromCookieHeader(req.headers.get("cookie"));
  if (raw) {
    try {
      await revokeSession(raw, { db: deps.db });
    } catch {
      /* ignore */
    }
  }
  return {
    status: 200,
    headers: noStoreHeaders(),
    body: { success: true },
    cookies: [buildClearSessionCookieHeader({ secure: deps.secureCookie })],
  };
}

/** Re-export for tests */
export { AuthDomainError };
