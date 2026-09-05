/**
 * Domain → HTTP error mapping. Never expose SQL/stack/internal names.
 */

import { NextResponse } from "next/server";
import type { V1Db } from "@/db/client";
import { isFamilyDomainError } from "@/v1/domain/family/errors";
import { isPersonDomainError } from "@/v1/domain/person/errors";
import { isRelationshipDomainError } from "@/v1/domain/relationship/errors";
import { isClaimDomainError } from "@/v1/domain/claim/errors";
import { isEvidenceDomainError } from "@/v1/domain/evidence/errors";
import { isMediaDomainError } from "@/v1/domain/media/errors";
import { HttpUnauthenticatedError } from "@/v1/http/authContext";
import { HttpForbiddenOriginError } from "@/v1/http/origin";
import { privateNoStoreHeaders } from "@/v1/http/origin";
import * as familyRepo from "@/v1/repositories/familyRepository";

export type HttpErrorBody = {
  success: false;
  code: string;
};

function json(status: number, code: string): NextResponse {
  return NextResponse.json(
    { success: false, code } satisfies HttpErrorBody,
    { status, headers: privateNoStoreHeaders() }
  );
}

/**
 * If actor is an ACTIVE family member → 403; else 404 (anti-enumeration).
 */
export async function forbiddenOrNotFound(
  familyId: string | null | undefined,
  userId: string,
  db: V1Db
): Promise<NextResponse> {
  if (!familyId) return json(404, "NOT_FOUND");
  try {
    const m = await familyRepo.findActiveMembership(db, familyId, userId);
    if (m) return json(403, "FORBIDDEN");
  } catch {
    /* fall through */
  }
  return json(404, "NOT_FOUND");
}

export async function mapDomainErrorToResponse(
  e: unknown,
  opts: {
    userId?: string;
    familyId?: string;
    db?: V1Db;
    /** When true, FORBIDDEN always → 404 (read paths). */
    readPath?: boolean;
  } = {}
): Promise<NextResponse> {
  if (e instanceof HttpUnauthenticatedError) {
    return json(401, "UNAUTHENTICATED");
  }
  if (e instanceof HttpForbiddenOriginError) {
    return json(403, "FORBIDDEN");
  }

  if (isFamilyDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "VERSION_CONFLICT":
        return json(409, "VERSION_CONFLICT");
      case "FAMILY_NOT_FOUND":
      case "OWNER_USER_NOT_FOUND":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  if (isPersonDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "PERSON_VERSION_CONFLICT":
        return json(409, "PERSON_VERSION_CONFLICT");
      case "PERSON_NOT_FOUND":
      case "PERSON_DELETED":
      case "FAMILY_NOT_FOUND":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  if (isRelationshipDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "DUPLICATE_RELATIONSHIP":
        return json(409, "DUPLICATE_RELATIONSHIP");
      case "ANCESTRY_CYCLE":
      case "GRAPH_CYCLE_DETECTED":
        return json(409, "ANCESTRY_CYCLE");
      case "SELF_RELATIONSHIP":
        return json(400, "INVALID_REQUEST");
      case "FAMILY_NOT_FOUND":
      case "PERSON_NOT_FOUND":
      case "PERSON_DELETED":
      case "RELATIONSHIP_NOT_FOUND":
      case "CROSS_FAMILY_RELATIONSHIP":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  if (isClaimDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "DUPLICATE_ACTIVE_CLAIM":
        return json(409, "DUPLICATE_CLAIM");
      case "CLAIM_NOT_FOUND":
      case "SUBJECT_NOT_FOUND":
      case "FAMILY_NOT_FOUND":
      case "CROSS_FAMILY":
      case "SUBJECT_NOT_READABLE":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      case "INVALID_CLAIM_STATUS_TRANSITION":
      case "REVIEW_CONFLICT":
        return json(409, "REVIEW_CONFLICT");
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  if (isEvidenceDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "EVIDENCE_ALREADY_LINKED":
        return json(409, "EVIDENCE_ALREADY_LINKED");
      case "EVIDENCE_NOT_FOUND":
      case "CLAIM_NOT_FOUND":
      case "FAMILY_NOT_FOUND":
      case "MEDIA_NOT_FOUND":
      case "CROSS_FAMILY":
      case "MEDIA_NOT_READABLE":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  if (isMediaDomainError(e)) {
    switch (e.code) {
      case "INVALID_INPUT":
        return json(400, "INVALID_REQUEST");
      case "FAMILY_NOT_FOUND":
      case "MEDIA_NOT_FOUND":
      case "MEDIA_NOT_ACTIVE":
        return json(404, "NOT_FOUND");
      case "FORBIDDEN":
        if (opts.readPath || !opts.userId || !opts.db) {
          return json(404, "NOT_FOUND");
        }
        return forbiddenOrNotFound(opts.familyId, opts.userId, opts.db);
      case "UPLOAD_FAILED":
      case "STORAGE_ERROR":
        return json(502, "UPLOAD_FAILED");
      default:
        return json(400, "INVALID_REQUEST");
    }
  }

  return json(500, "INTERNAL_ERROR");
}

export function invalidRequest(): NextResponse {
  return json(400, "INVALID_REQUEST");
}

export function unsupportedMedia(): NextResponse {
  return json(415, "UNSUPPORTED_MEDIA_TYPE");
}

export function notFound(): NextResponse {
  return json(404, "NOT_FOUND");
}

export function unauthenticated(): NextResponse {
  return json(401, "UNAUTHENTICATED");
}
