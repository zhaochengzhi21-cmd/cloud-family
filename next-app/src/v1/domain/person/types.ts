import type {
  LivingStatus,
  PersonGender,
  PrivacyLevel,
} from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type PersonView = {
  id: string;
  familyId: string;
  preferredName: string;
  gender: PersonGender;
  livingStatus: LivingStatus;
  privacyLevel: PrivacyLevel;
  revisionNo: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatePersonInput = {
  familyId: string;
  actorContext: AccessContext;
  preferredName: string;
  gender?: PersonGender;
  livingStatus?: LivingStatus;
  privacyLevel?: PrivacyLevel;
};

export type UpdatePersonInput = {
  personId: string;
  actorContext: AccessContext;
  expectedRevision: number;
  preferredName?: string;
  gender?: PersonGender;
  livingStatus?: LivingStatus;
  privacyLevel?: PrivacyLevel;
};

export type CreatePersonResult = {
  person: PersonView;
  familyVersion: number;
};

export type UpdatePersonResult =
  | {
      status: "UPDATED";
      person: PersonView;
      familyVersion: number;
      changedFields: string[];
    }
  | {
      status: "NO_CHANGES";
      person: PersonView;
    };

export type DeletePersonResult = {
  personId: string;
  familyVersion: number;
  relationshipsRemovedCount: number;
};
