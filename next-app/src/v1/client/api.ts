/**
 * Thin V1 JSON API client for Closed Alpha UI.
 * credentials: same-origin. Server Permission remains authority.
 */

import { ERROR_COPY } from "@/v1/ui/copy";
import type { FamilyExport } from "@/v1/services/exportService";

/** FamilyExport after JSON transport (dates are already ISO strings). */
export type FamilyExportJson = FamilyExport;

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "VERSION_CONFLICT"
  | "PERSON_VERSION_CONFLICT"
  | "ANCESTRY_CYCLE"
  | "DUPLICATE_RELATIONSHIP"
  | "DUPLICATE_CLAIM"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UPLOAD_FAILED"
  | "NETWORK"
  | "UNKNOWN";

export class V1ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: string) {
    super(code);
    this.name = "V1ApiError";
    this.status = status;
    this.code = (code as ApiErrorCode) || "UNKNOWN";
  }
}

export function userMessageForApiError(e: unknown): string {
  if (!(e instanceof V1ApiError)) return ERROR_COPY.generic;
  switch (e.code) {
    case "UNAUTHENTICATED":
      return ERROR_COPY.unauthenticated;
    case "FORBIDDEN":
      return ERROR_COPY.forbidden;
    case "NOT_FOUND":
      return ERROR_COPY.notFound;
    case "VERSION_CONFLICT":
      return ERROR_COPY.familyConflict;
    case "PERSON_VERSION_CONFLICT":
      return ERROR_COPY.personConflict;
    case "ANCESTRY_CYCLE":
      return ERROR_COPY.ancestryCycle;
    case "DUPLICATE_RELATIONSHIP":
      return ERROR_COPY.duplicateRelationship;
    case "DUPLICATE_CLAIM":
      return ERROR_COPY.duplicateClaim;
    default:
      return ERROR_COPY.generic;
  }
}

type FetchOpts = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Default 30s — avoid indefinite loading when Neon/DNS stalls. */
  timeoutMs?: number;
  /** Extra request headers (e.g. Idempotency-Key for agent retries). */
  headers?: Record<string, string>;
};

function resolveFetchSignal(
  user: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (!user) {
    return timeout ?? new AbortController().signal;
  }
  if (
    timeout &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.any === "function"
  ) {
    return AbortSignal.any([user, timeout]);
  }
  return user;
}

async function v1Fetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const signal = resolveFetchSignal(opts.signal, opts.timeoutMs ?? 30_000);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch {
    throw new V1ApiError(0, "NETWORK");
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const code =
      json &&
      typeof json === "object" &&
      "code" in json &&
      typeof (json as { code: unknown }).code === "string"
        ? (json as { code: string }).code
        : "UNKNOWN";
    throw new V1ApiError(res.status, code);
  }

  return json as T;
}

export const v1api = {
  requestCode: (body: { email: string; inviteToken?: string }) =>
    v1Fetch<{ success: boolean; challengeId?: string }>(
      "/api/v1/auth/request-code",
      { method: "POST", body }
    ),

  verify: (body: { challengeId: string; code: string }) =>
    v1Fetch<{ success: boolean; user?: { id: string } }>(
      "/api/v1/auth/verify",
      { method: "POST", body }
    ),

  me: () =>
    v1Fetch<{ user: { id: string } | null }>("/api/v1/auth/me"),

  logout: () =>
    v1Fetch<{ success: boolean }>("/api/v1/auth/logout", { method: "POST", body: {} }),

  listFamilies: () =>
    v1Fetch<{
      families: Array<{
        id: string;
        displayName: string;
        surname: string | null;
        visibility: string;
        discoveryEnabled: boolean;
        currentVersionNo: number;
        role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
      }>;
    }>("/api/v1/families"),

  createFamily: (body: { displayName: string; surname?: string | null }) =>
    v1Fetch<{
      family: {
        id: string;
        displayName: string;
        surname: string | null;
        visibility: string;
        discoveryEnabled: boolean;
        currentVersionNo: number;
      };
    }>("/api/v1/families", {
      method: "POST",
      body: {
        displayName: body.displayName,
        surname: body.surname ?? null,
        visibility: "PRIVATE",
        discoveryEnabled: false,
      },
    }),

  getFamily: (familyId: string) =>
    v1Fetch<{
      family: {
        id: string;
        displayName: string;
        surname: string | null;
        visibility: string;
        discoveryEnabled: boolean;
        currentVersionNo: number;
      };
    }>(`/api/v1/families/${familyId}`),

  patchFamily: (
    familyId: string,
    body: {
      expectedVersion: number;
      displayName?: string;
      surname?: string | null;
    }
  ) =>
    v1Fetch<{
      family: {
        id: string;
        displayName: string;
        surname: string | null;
        visibility: string;
        discoveryEnabled: boolean;
        currentVersionNo: number;
      };
      familyVersion: number;
      status: string;
    }>(`/api/v1/families/${familyId}`, {
      method: "PATCH",
      body,
    }),

  getGraph: (familyId: string) =>
    v1Fetch<{
      graph: {
        familyId: string;
        persons: Array<{
          id: string;
          preferredName: string;
          gender: string;
          livingStatus: string;
          privacyLevel: string;
          revisionNo: number;
        }>;
        relationships: Array<{
          id: string;
          type: string;
          fromPersonId: string;
          toPersonId: string;
        }>;
        totalGenerations: number;
        componentCount: number;
        generationByPerson: Record<string, number>;
        rootPersonIds: string[];
      };
    }>(`/api/v1/families/${familyId}/graph`),

  getOverview: (familyId: string) =>
    v1Fetch<{
      overview: {
        personStats: Record<
          string,
          {
            proposed: number;
            accepted: number;
            conflicted: number;
            claimTypes: string[];
          }
        >;
        pendingTotal: number;
        pending: Array<{
          claimId: string;
          personId: string;
          claimType: string;
          status: string;
          originType: string;
          text: string | null;
          createdAt: string;
        }>;
        acceptedTotal: number;
        sourcedAcceptedTotal: number;
        unsourcedAcceptedTotal: number;
        unsourcedAccepted: Array<{
          claimId: string;
          personId: string;
          claimType: string;
          status: string;
          originType: string;
          text: string | null;
          createdAt: string;
        }>;
      };
    }>(`/api/v1/families/${familyId}/overview`),

  getActivity: (familyId: string, limit = 15) =>
    v1Fetch<{
      activity: Array<{
        id: string;
        at: string;
        eventType: string;
        actor: { isYou: boolean; role: string | null };
        personId?: string;
        personName?: string;
        otherPersonId?: string;
        otherPersonName?: string;
        claimId?: string;
        claimType?: string;
        originType?: string;
        relationshipId?: string;
        relationshipType?: string;
        evidenceId?: string;
        evidenceType?: string;
        restorable?: boolean;
      }>;
    }>(`/api/v1/families/${familyId}/activity?limit=${limit}`),

  getFamilyAccess: (familyId: string) =>
    v1Fetch<{
      invites: Array<{
        id: string;
        role: string;
        expiresAt: string;
        createdAt: string;
      }>;
      members: Array<{
        membershipId: string;
        role: string;
        isYou: boolean;
        joinedAt: string;
        maskedEmail: string | null;
        manageable: boolean;
      }>;
      actorRole: string;
      invitableRoles: Array<"ADMIN" | "EDITOR" | "VIEWER">;
    }>(`/api/v1/families/${familyId}/invites`),

  updateFamilyMemberRole: (
    familyId: string,
    membershipId: string,
    role: "ADMIN" | "EDITOR" | "VIEWER",
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ membership: { membershipId: string; role: string } }>(
      `/api/v1/families/${familyId}/members/${membershipId}`,
      {
        method: "PATCH",
        body: { role },
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  removeFamilyMember: (
    familyId: string,
    membershipId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ membershipId: string }>(
      `/api/v1/families/${familyId}/members/${membershipId}`,
      {
        method: "DELETE",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  leaveFamily: (familyId: string, opts?: { idempotencyKey?: string }) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ membershipId: string }>(
      `/api/v1/families/${familyId}/members/me/leave`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  createFamilyInvite: (
    familyId: string,
    role: "ADMIN" | "EDITOR" | "VIEWER",
    options?: { email?: string }
  ) =>
    v1Fetch<{
      invite: { id: string; role: string; expiresAt: string; createdAt: string };
      token: string;
      emailDelivery: "sent" | "skipped" | "failed" | null;
    }>(`/api/v1/families/${familyId}/invites`, {
      method: "POST",
      body: { role, email: options?.email },
    }),

  revokeFamilyInvite: (familyId: string, inviteId: string) =>
    v1Fetch<{ inviteId: string }>(
      `/api/v1/families/${familyId}/invites/${inviteId}`,
      { method: "DELETE", body: {} }
    ),

  previewInvite: (token: string) =>
    v1Fetch<{
      invite: {
        status: "OPEN" | "UNAVAILABLE" | "ALREADY_MEMBER";
        familyId: string | null;
        familyName: string | null;
        role: string | null;
      };
    }>(`/api/v1/invites/${encodeURIComponent(token)}`),

  acceptInvite: (token: string) =>
    v1Fetch<{
      membership: { familyId: string; role: string; alreadyMember: boolean };
    }>(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: {},
    }),

  getGenerationWords: (familyId: string) =>
    v1Fetch<{ generationWords: Record<string, string> }>(
      `/api/v1/families/${familyId}/generation-words`
    ),

  getBirthOrders: (familyId: string) =>
    v1Fetch<{ birthOrders: Record<string, string> }>(
      `/api/v1/families/${familyId}/birth-orders`
    ),

  exportFamily: (familyId: string) =>
    v1Fetch<{ export: FamilyExportJson }>(
      `/api/v1/families/${familyId}/export`,
      { timeoutMs: 120_000 }
    ),

  createPerson: (
    familyId: string,
    body: {
      preferredName: string;
      gender?: string;
      livingStatus?: string;
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      person: {
        id: string;
        preferredName: string;
        gender: string;
        livingStatus: string;
        privacyLevel: string;
        revisionNo: number;
      };
      familyVersion: number;
    }>(`/api/v1/families/${familyId}/persons`, {
      method: "POST",
      body: {
        preferredName: body.preferredName,
        gender: body.gender ?? "UNKNOWN",
        livingStatus: body.livingStatus ?? "UNKNOWN",
        privacyLevel: "INHERIT",
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  createPersonsBatch: (
    familyId: string,
    body: {
      persons: Array<{
        preferredName: string;
        gender?: string;
        livingStatus?: string;
        clientItemId?: string;
      }>;
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      results: Array<
        | {
            index: number;
            ok: true;
            person: { id: string; preferredName: string };
            clientItemId?: string;
          }
        | { index: number; ok: false; code: string; clientItemId?: string }
      >;
      created: number;
      failed: number;
      familyVersion: number | null;
    }>(`/api/v1/families/${familyId}/persons/batch`, {
      method: "POST",
      body: {
        persons: body.persons.map((p) => ({
          preferredName: p.preferredName,
          gender: p.gender ?? "UNKNOWN",
          livingStatus: p.livingStatus ?? "UNKNOWN",
          privacyLevel: "INHERIT",
          clientItemId: p.clientItemId,
        })),
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  patchPerson: (
    familyId: string,
    personId: string,
    body: {
      expectedRevision: number;
      preferredName?: string;
      gender?: string;
      livingStatus?: string;
    }
  ) =>
    v1Fetch<{
      person: {
        id: string;
        preferredName: string;
        revisionNo: number;
        livingStatus: string;
        gender: string;
      };
      status: string;
    }>(`/api/v1/families/${familyId}/persons/${personId}`, {
      method: "PATCH",
      body,
    }),

  deletePerson: (
    familyId: string,
    personId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      personId: string;
      familyVersion: number;
      relationshipsRemovedCount: number;
    }>(`/api/v1/families/${familyId}/persons/${personId}`, {
      method: "DELETE",
      body: {},
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  restorePerson: (
    familyId: string,
    personId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      person: { id: string; preferredName: string };
      familyVersion: number;
      relationshipsRestoredCount: number;
    }>(`/api/v1/families/${familyId}/persons/${personId}/restore`, {
      method: "POST",
      body: {},
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  createRelationship: (
    familyId: string,
    body: {
      fromPersonId: string;
      toPersonId: string;
      relationshipType: string;
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ relationship: { id: string }; familyVersion: number }>(
      `/api/v1/families/${familyId}/relationships`,
      {
        method: "POST",
        body,
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  createRelationshipsBatch: (
    familyId: string,
    body: {
      relationships: Array<{
        fromPersonId: string;
        toPersonId: string;
        relationshipType: string;
        clientItemId?: string;
      }>;
      onDuplicate?: "error" | "reuse";
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      results: Array<
        | {
            index: number;
            ok: true;
            relationship: { id: string };
            reused: boolean;
            clientItemId?: string;
          }
        | { index: number; ok: false; code: string; clientItemId?: string }
      >;
      created: number;
      reused: number;
      failed: number;
      familyVersion: number | null;
    }>(`/api/v1/families/${familyId}/relationships/batch`, {
      method: "POST",
      body: {
        relationships: body.relationships,
        onDuplicate: body.onDuplicate ?? "reuse",
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  deleteRelationship: (
    familyId: string,
    relationshipId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ relationshipId: string; familyVersion: number }>(
      `/api/v1/families/${familyId}/relationships/${relationshipId}`,
      {
        method: "DELETE",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  restoreRelationship: (
    familyId: string,
    relationshipId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      relationship: {
        id: string;
        fromPersonId: string;
        toPersonId: string;
        relationshipType: string;
      };
      familyVersion: number;
    }>(
      `/api/v1/families/${familyId}/relationships/${relationshipId}/restore`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  createClaim: (
    familyId: string,
    body: {
      subjectId: string;
      claimType: string;
      value: { text: string; narrator?: string | null };
      originType?: "MANUAL" | "AI_EXTRACTION" | "IMPORT";
      confidence?: number | null;
    },
    opts?: { idempotencyKey?: string; clientAgent?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.clientAgent) headers["X-Client-Agent"] = opts.clientAgent;
    return v1Fetch<{
      claim: {
        id: string;
        claimType: string;
        value: { text?: string; narrator?: string | null };
        status: string;
        originType: string;
        confidence: number | null;
      };
    }>(`/api/v1/families/${familyId}/claims`, {
      method: "POST",
      body: {
        subjectType: "PERSON",
        subjectId: body.subjectId,
        claimType: body.claimType,
        value: body.value,
        originType: body.originType ?? "MANUAL",
        confidence: body.confidence ?? null,
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  createClaimsBatch: (
    familyId: string,
    body: {
      claims: Array<{
        subjectId: string;
        claimType: string;
        value: { text: string; narrator?: string | null };
        originType?: "MANUAL" | "AI_EXTRACTION" | "IMPORT";
        confidence?: number | null;
        clientItemId?: string;
      }>;
      onDuplicate?: "error" | "reuse";
    },
    opts?: { idempotencyKey?: string; clientAgent?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.clientAgent) headers["X-Client-Agent"] = opts.clientAgent;
    return v1Fetch<{
      results: Array<
        | {
            index: number;
            ok: true;
            claim: {
              id: string;
              claimType: string;
              status: string;
              originType: string;
            };
            reused: boolean;
            clientItemId?: string;
          }
        | {
            index: number;
            ok: false;
            code: string;
            clientItemId?: string;
          }
      >;
      created: number;
      reused: number;
      failed: number;
      familyVersion: number | null;
    }>(`/api/v1/families/${familyId}/claims/batch`, {
      method: "POST",
      body: {
        claims: body.claims.map((c) => ({
          subjectType: "PERSON",
          subjectId: c.subjectId,
          claimType: c.claimType,
          value: c.value,
          originType: c.originType ?? "AI_EXTRACTION",
          confidence: c.confidence ?? null,
          clientItemId: c.clientItemId,
        })),
        onDuplicate: body.onDuplicate ?? "reuse",
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  proposeAgentPackage: (
    familyId: string,
    body: {
      originType?: "AI_EXTRACTION" | "IMPORT";
      persons?: Array<{
        preferredName: string;
        gender?: string;
        livingStatus?: string;
        clientItemId?: string;
      }>;
      relationships?: Array<{
        fromPersonId?: string;
        toPersonId?: string;
        fromClientItemId?: string;
        toClientItemId?: string;
        relationshipType: string;
        clientItemId?: string;
      }>;
      claims?: Array<{
        subjectId?: string;
        subjectClientItemId?: string;
        claimType: string;
        value: { text: string; narrator?: string | null };
        confidence?: number | null;
        clientItemId?: string;
      }>;
      evidence?: {
        evidenceType: string;
        title?: string | null;
        description?: string | null;
        sourceLocator?: string | null;
        claimClientItemIds?: string[];
        claimIds?: string[];
      } | null;
    },
    opts?: { idempotencyKey?: string; clientAgent?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.clientAgent) headers["X-Client-Agent"] = opts.clientAgent;
    return v1Fetch<{
      personMap: Record<string, string>;
      claimMap: Record<string, string>;
      persons: { created: number; failed: number };
      relationships: { created: number; reused: number; failed: number };
      claims: { created: number; reused: number; failed: number };
      evidence: {
        evidenceId: string | null;
        linked: number;
        reused: number;
        failed: number;
      };
      familyVersion: number | null;
    }>(`/api/v1/families/${familyId}/agent/propose`, {
      method: "POST",
      body,
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  getAgentChannel: (
    familyId: string,
    opts?: { limit?: number; since?: string }
  ) => {
    const limit = opts?.limit ?? 40;
    const q = new URLSearchParams({ limit: String(limit) });
    if (opts?.since) q.set("since", opts.since);
    return v1Fetch<{
      agent: {
        principles: string[];
        playbook: string[];
        claimTypes: Array<{
          type: string;
          cardinality: string;
          kind: string;
          valueShape: string;
        }>;
        recentDecisions: Array<{
          id: string;
          at: string;
          decision: string;
          claimId: string;
          claimType?: string;
          personId?: string;
          personName?: string;
        }>;
        capabilities: Array<{
          id: string;
          summary: string;
          method: string;
          path: string;
          roles: string[];
          bodyHints?: Record<string, string>;
          policy: string[];
        }>;
        tasks: Array<{
          id: string;
          kind: string;
          priority: number;
          personId?: string;
          personName?: string;
          claimId?: string;
          claimType?: string;
          originType?: string;
          text?: string | null;
          suggest: { method: string; path: string; note: string };
        }>;
        taskTotal: number;
      };
    }>(`/api/v1/families/${familyId}/agent?${q.toString()}`);
  },

  listPersonClaims: (familyId: string, personId: string) =>
    v1Fetch<{
      claims: Array<{
        id: string;
        claimType: string;
        value: { text?: string; narrator?: string | null };
        status: string;
        originType: string;
        confidence: number | null;
        reviewedAt: string | null;
      }>;
    }>(
      `/api/v1/families/${familyId}/persons/${personId}/claims?includeRejected=true`
    ),

  getClaim: (familyId: string, claimId: string) =>
    v1Fetch<{
      claim: {
        id: string;
        claimType: string;
        value: { text?: string };
        status: string;
      };
      evidenceLinks: Array<{
        relation: string;
        evidence: {
          id: string;
          evidenceType: string;
          title: string | null;
          description: string | null;
          sourceLocator: string | null;
          sourceDateText: string | null;
          visibility: string;
          mediaObjectId: string | null;
        };
      }>;
    }>(`/api/v1/families/${familyId}/claims/${claimId}`),

  acceptClaim: (
    familyId: string,
    claimId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/accept`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  reviewClaimsBatch: (
    familyId: string,
    body: { action: "accept" | "reject"; claimIds: string[] },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      action: string;
      succeeded: number;
      failed: number;
      results: Array<
        | { index: number; ok: true; claim: { id: string; status: string } }
        | { index: number; ok: false; claimId: string; code: string }
      >;
      familyVersion: number | null;
    }>(`/api/v1/families/${familyId}/claims/review-batch`, {
      method: "POST",
      body,
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  preferClaim: (
    familyId: string,
    claimId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/prefer`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  rejectClaim: (
    familyId: string,
    claimId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/reject`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  reopenClaim: (
    familyId: string,
    claimId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/reopen`,
      {
        method: "POST",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  listEvidence: (familyId: string, limit = 100) =>
    v1Fetch<{
      evidence: Array<{
        id: string;
        evidenceType: string;
        title: string | null;
        description: string | null;
        sourceLocator: string | null;
        sourceDateText: string | null;
        mediaObjectId: string | null;
        mimeType: string | null;
        linkCount: number;
        createdAt: string;
      }>;
    }>(`/api/v1/families/${familyId}/evidence?limit=${limit}`),

  createEvidence: (
    familyId: string,
    body: {
      evidenceType: string;
      title?: string | null;
      description?: string | null;
      sourceLocator?: string | null;
      sourceDateText?: string | null;
      mediaObjectId?: string | null;
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ evidence: { id: string } }>(
      `/api/v1/families/${familyId}/evidence`,
      {
        method: "POST",
        body: {
          ...body,
          visibility: "FAMILY",
        },
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  deleteEvidence: (
    familyId: string,
    evidenceId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ evidenceId: string; familyVersion: number }>(
      `/api/v1/families/${familyId}/evidence/${evidenceId}`,
      {
        method: "DELETE",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  restoreEvidence: (
    familyId: string,
    evidenceId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      evidence: { id: string; evidenceType: string; title: string | null };
      familyVersion: number;
    }>(`/api/v1/families/${familyId}/evidence/${evidenceId}/restore`, {
      method: "POST",
      body: {},
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  listEvidenceLinks: (familyId: string, evidenceId: string) =>
    v1Fetch<{
      links: Array<{
        claimId: string;
        claimType: string;
        status: string;
        personId: string;
        personName: string;
      }>;
    }>(`/api/v1/families/${familyId}/evidence/${evidenceId}`),

  linkEvidence: (
    familyId: string,
    claimId: string,
    body: { evidenceId: string; relation: string },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{ claimId: string }>(
      `/api/v1/families/${familyId}/claims/${claimId}/evidence`,
      {
        method: "POST",
        body,
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  unlinkEvidence: (
    familyId: string,
    claimId: string,
    evidenceId: string,
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      claimId: string;
      evidenceId: string;
      relation: string;
      familyVersion: number;
    }>(
      `/api/v1/families/${familyId}/claims/${claimId}/evidence/${evidenceId}`,
      {
        method: "DELETE",
        body: {},
        headers: Object.keys(headers).length ? headers : undefined,
      }
    );
  },

  linkEvidenceBatch: (
    familyId: string,
    evidenceId: string,
    body: {
      claimIds: string[];
      relation?: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
      onDuplicate?: "error" | "reuse";
    },
    opts?: { idempotencyKey?: string; clientAgent?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts?.clientAgent) headers["X-Client-Agent"] = opts.clientAgent;
    return v1Fetch<{
      evidenceId: string;
      linked: number;
      reused: number;
      failed: number;
      results: Array<
        | {
            index: number;
            ok: true;
            claimId: string;
            evidenceId: string;
            relation: string;
            reused: boolean;
          }
        | { index: number; ok: false; claimId: string; code: string }
      >;
    }>(`/api/v1/families/${familyId}/evidence/${evidenceId}/links`, {
      method: "POST",
      body: {
        claimIds: body.claimIds,
        relation: body.relation ?? "SUPPORTS",
        onDuplicate: body.onDuplicate ?? "reuse",
      },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  reserveMedia: (
    familyId: string,
    body: {
      originalFilename?: string | null;
      mimeType: string;
      byteSize: number;
    },
    opts?: { idempotencyKey?: string }
  ) => {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return v1Fetch<{
      media: { id: string; status: string };
      upload: {
        pathname: string;
        handleUploadUrl: string;
        multipartRecommended: boolean;
      };
    }>(`/api/v1/families/${familyId}/media/upload-intents`, {
      method: "POST",
      body: { ...body, visibility: "FAMILY" },
      headers: Object.keys(headers).length ? headers : undefined,
    });
  },

  mediaStatus: (familyId: string, mediaId: string) =>
    v1Fetch<{ mediaId: string; status: string }>(
      `/api/v1/families/${familyId}/media/${mediaId}/status`
    ),

  /**
   * Local/Preview only when server has V1_BLOB_LOCAL_FINALIZE=true.
   * Production returns 404 — callers must ignore failures.
   */
  mediaFinalizeLocal: (familyId: string, mediaId: string) =>
    v1Fetch<{ mediaId: string; status: string }>(
      `/api/v1/families/${familyId}/media/${mediaId}/finalize-local`,
      { method: "POST", body: {} }
    ),

  mediaRead: (familyId: string, mediaId: string) =>
    v1Fetch<{
      media: { id: string; mimeType: string | null; byteSize: number | null };
      read: { url: string; expiresAt: string };
    }>(`/api/v1/families/${familyId}/media/${mediaId}`),
};
