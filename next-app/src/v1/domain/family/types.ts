import type { FamilyVisibility } from "@/db/constants";

export type { FamilyVisibility };

export type CreateFamilyInput = {
  ownerUserId: string;
  displayName: string;
  surname?: string | null;
  visibility?: FamilyVisibility;
  discoveryEnabled?: boolean;
};

export type UpdateFamilyIdentityInput = {
  familyId: string;
  actorUserId: string;
  expectedVersion: number;
  displayName?: string;
  surname?: string | null;
  visibility?: FamilyVisibility;
  discoveryEnabled?: boolean;
};

/** Trusted server-side family identity read model. */
export type FamilyIdentity = {
  id: string;
  displayName: string;
  surname: string | null;
  visibility: FamilyVisibility;
  discoveryEnabled: boolean;
  createdByUserId: string | null;
  currentVersionNo: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateFamilyResult = {
  family: FamilyIdentity;
};

export type UpdateFamilyResult =
  | {
      status: "UPDATED";
      family: FamilyIdentity;
      fromVersion: number;
      toVersion: number;
      changedFields: string[];
    }
  | {
      status: "NO_CHANGES";
      family: FamilyIdentity;
    };
