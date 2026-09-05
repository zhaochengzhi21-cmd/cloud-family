/**
 * Explicit Workspace DTOs — never return raw DB rows.
 */

import type { FamilyIdentity } from "@/v1/domain/family/types";
import type { MembershipRole } from "@/db/constants";
import type { PersonView } from "@/v1/domain/person/types";
import type { RelationshipView } from "@/v1/domain/relationship/types";
import type { ClaimDto, ClaimBundle } from "@/v1/domain/claim/types";
import type { EvidenceDto } from "@/v1/domain/evidence/types";
import type { FamilyGraphDto } from "@/v1/services/familyGraphService";
import { NextResponse } from "next/server";
import { privateNoStoreHeaders } from "@/v1/http/origin";

export function familyDto(f: FamilyIdentity) {
  return {
    id: f.id,
    displayName: f.displayName,
    surname: f.surname,
    visibility: f.visibility,
    discoveryEnabled: f.discoveryEnabled,
    currentVersionNo: f.currentVersionNo,
  };
}

export function familyListItemDto(f: FamilyIdentity, role: MembershipRole) {
  return {
    ...familyDto(f),
    role,
  };
}

export function personDto(p: PersonView) {
  return {
    id: p.id,
    familyId: p.familyId,
    preferredName: p.preferredName,
    gender: p.gender,
    livingStatus: p.livingStatus,
    privacyLevel: p.privacyLevel,
    revisionNo: p.revisionNo,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function relationshipDto(r: RelationshipView) {
  return {
    id: r.id,
    familyId: r.familyId,
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
    relationshipType: r.relationshipType,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function claimDto(c: ClaimDto) {
  return {
    id: c.id,
    familyId: c.familyId,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    claimType: c.claimType,
    value: c.value,
    status: c.status,
    confidence: c.confidence,
    originType: c.originType,
    createdAt: c.createdAt.toISOString(),
    reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null,
  };
}

export function evidenceDto(e: EvidenceDto) {
  return {
    id: e.id,
    familyId: e.familyId,
    evidenceType: e.evidenceType,
    title: e.title,
    description: e.description,
    sourceLocator: e.sourceLocator,
    sourceDateText: e.sourceDateText,
    visibility: e.visibility,
    mediaObjectId: e.mediaObjectId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function claimBundleDto(b: ClaimBundle) {
  return {
    claim: claimDto(b.claim),
    evidenceLinks: b.evidenceLinks.map((l) => ({
      relation: l.relation,
      evidence: evidenceDto(l.evidence),
    })),
  };
}

export function graphDto(g: FamilyGraphDto) {
  return g;
}

export function okJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: privateNoStoreHeaders(),
  });
}
