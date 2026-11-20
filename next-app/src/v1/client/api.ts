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
  const headers: Record<string, string> = {};
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
      members: Array<{ role: string; isYou: boolean; joinedAt: string }>;
      invitableRoles: Array<"ADMIN" | "EDITOR" | "VIEWER">;
    }>(`/api/v1/families/${familyId}/invites`),

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
    }
  ) =>
    v1Fetch<{
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
    }),

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

  deletePerson: (familyId: string, personId: string) =>
    v1Fetch<{
      personId: string;
      familyVersion: number;
      relationshipsRemovedCount: number;
    }>(`/api/v1/families/${familyId}/persons/${personId}`, {
      method: "DELETE",
      body: {},
    }),

  restorePerson: (familyId: string, personId: string) =>
    v1Fetch<{
      person: { id: string; preferredName: string };
      familyVersion: number;
      relationshipsRestoredCount: number;
    }>(`/api/v1/families/${familyId}/persons/${personId}/restore`, {
      method: "POST",
      body: {},
    }),

  createRelationship: (
    familyId: string,
    body: {
      fromPersonId: string;
      toPersonId: string;
      relationshipType: string;
    }
  ) =>
    v1Fetch<{ relationship: { id: string }; familyVersion: number }>(
      `/api/v1/families/${familyId}/relationships`,
      { method: "POST", body }
    ),

  deleteRelationship: (familyId: string, relationshipId: string) =>
    v1Fetch<{ relationshipId: string; familyVersion: number }>(
      `/api/v1/families/${familyId}/relationships/${relationshipId}`,
      { method: "DELETE", body: {} }
    ),

  restoreRelationship: (familyId: string, relationshipId: string) =>
    v1Fetch<{
      relationship: {
        id: string;
        fromPersonId: string;
        toPersonId: string;
        relationshipType: string;
      };
      familyVersion: number;
    }>(
      `/api/v1/families/${familyId}/relationships/${relationshipId}/restore`,
      { method: "POST", body: {} }
    ),

  createClaim: (
    familyId: string,
    body: {
      subjectId: string;
      claimType: string;
      value: { text: string; narrator?: string | null };
    }
  ) =>
    v1Fetch<{
      claim: {
        id: string;
        claimType: string;
        value: { text?: string; narrator?: string | null };
        status: string;
      };
    }>(`/api/v1/families/${familyId}/claims`, {
      method: "POST",
      body: {
        subjectType: "PERSON",
        subjectId: body.subjectId,
        claimType: body.claimType,
        value: body.value,
        originType: "MANUAL",
      },
    }),

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

  acceptClaim: (familyId: string, claimId: string) =>
    v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/accept`,
      { method: "POST", body: {} }
    ),

  preferClaim: (familyId: string, claimId: string) =>
    v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/prefer`,
      { method: "POST", body: {} }
    ),

  rejectClaim: (familyId: string, claimId: string) =>
    v1Fetch<{ claim: { id: string; status: string } }>(
      `/api/v1/families/${familyId}/claims/${claimId}/reject`,
      { method: "POST", body: {} }
    ),

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
    }
  ) =>
    v1Fetch<{ evidence: { id: string } }>(
      `/api/v1/families/${familyId}/evidence`,
      {
        method: "POST",
        body: {
          ...body,
          visibility: "FAMILY",
        },
      }
    ),

  deleteEvidence: (familyId: string, evidenceId: string) =>
    v1Fetch<{ evidenceId: string; familyVersion: number }>(
      `/api/v1/families/${familyId}/evidence/${evidenceId}`,
      { method: "DELETE", body: {} }
    ),

  restoreEvidence: (familyId: string, evidenceId: string) =>
    v1Fetch<{
      evidence: { id: string; evidenceType: string; title: string | null };
      familyVersion: number;
    }>(`/api/v1/families/${familyId}/evidence/${evidenceId}/restore`, {
      method: "POST",
      body: {},
    }),

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
    body: { evidenceId: string; relation: string }
  ) =>
    v1Fetch<{ claimId: string }>(
      `/api/v1/families/${familyId}/claims/${claimId}/evidence`,
      { method: "POST", body }
    ),

  reserveMedia: (
    familyId: string,
    body: {
      originalFilename?: string | null;
      mimeType: string;
      byteSize: number;
    }
  ) =>
    v1Fetch<{
      media: { id: string; status: string };
      upload: {
        pathname: string;
        handleUploadUrl: string;
        multipartRecommended: boolean;
      };
    }>(`/api/v1/families/${familyId}/media/upload-intents`, {
      method: "POST",
      body: { ...body, visibility: "FAMILY" },
    }),

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
