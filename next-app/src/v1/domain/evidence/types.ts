import type {
  ClaimEvidenceRelation,
  EvidenceType,
  EvidenceVisibility,
} from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type EvidenceDto = {
  id: string;
  familyId: string;
  evidenceType: EvidenceType;
  title: string | null;
  description: string | null;
  sourceLocator: string | null;
  sourceDateText: string | null;
  visibility: EvidenceVisibility;
  mediaObjectId: string | null;
  createdAt: Date;
};

export type CreateEvidenceInput = {
  familyId: string;
  actorContext: AccessContext;
  evidenceType: EvidenceType;
  title?: string | null;
  description?: string | null;
  mediaObjectId?: string | null;
  sourceLocator?: string | null;
  sourceDateText?: string | null;
  visibility?: EvidenceVisibility;
};

export type CreateEvidenceResult = {
  evidence: EvidenceDto;
  familyVersion: number;
};

export type DeleteEvidenceResult = {
  evidenceId: string;
  familyVersion: number;
};

export type LinkEvidenceInput = {
  familyId: string;
  actorContext: AccessContext;
  claimId: string;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
};

export type LinkEvidenceResult = {
  claimId: string;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
  familyVersion: number;
};
