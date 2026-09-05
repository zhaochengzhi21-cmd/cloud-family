import type {
  ClaimOriginType,
  ClaimStatus,
  ClaimSubjectType,
  ClaimType,
  RelationshipType,
} from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type ClaimCardinality = "SINGLETON" | "MULTI";

export type TextualClaimValue = {
  text: string;
};

export type RelationshipAssertionDirection =
  | "SUBJECT_IS_PARENT_OF"
  | "SUBJECT_IS_CHILD_OF"
  | "SUBJECT_IS_SPOUSE_OF";

export type RelationshipAssertionValue = {
  otherPersonId: string;
  relationshipType: RelationshipType;
  direction: RelationshipAssertionDirection;
};

export type ClaimValue = TextualClaimValue | RelationshipAssertionValue;

export type ClaimDto = {
  id: string;
  familyId: string;
  subjectType: ClaimSubjectType;
  subjectId: string;
  claimType: ClaimType;
  value: ClaimValue;
  status: ClaimStatus;
  confidence: number | null;
  originType: ClaimOriginType;
  createdAt: Date;
  reviewedAt: Date | null;
};

export type CreateClaimInput = {
  familyId: string;
  actorContext: AccessContext;
  subjectType: ClaimSubjectType;
  subjectId: string;
  claimType: ClaimType;
  value: unknown;
  confidence?: number | null;
  originType?: ClaimOriginType;
};

export type CreateClaimResult = {
  claim: ClaimDto;
  familyVersion: number;
};

export type ReviewClaimResult = {
  claim: ClaimDto;
  familyVersion: number;
  conflictCount: number;
  changedClaimCount: number;
};

export type ClaimWithEvidenceLink = {
  relation: import("@/db/constants").ClaimEvidenceRelation;
  evidence: import("@/v1/domain/evidence/types").EvidenceDto;
};

export type ClaimBundle = {
  claim: ClaimDto;
  evidenceLinks: ClaimWithEvidenceLink[];
};
