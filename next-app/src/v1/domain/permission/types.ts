import type {
  FamilyVisibility,
  LivingStatus,
  MembershipRole,
  PrivacyLevel,
} from "@/db/constants";

export const PERMISSION_ACTIONS = [
  "READ_FAMILY",
  "READ_PERSON",
  "READ_MEDIA",
  "READ_EVIDENCE",
  "EDIT_FAMILY_IDENTITY",
  "EDIT_PERSON",
  "EDIT_RELATIONSHIP",
  "EDIT_CLAIM",
  "EDIT_EVIDENCE",
  "REVIEW_CLAIM",
  "UPLOAD_MEDIA",
  "MANAGE_MEMBERS",
  "MANAGE_PRIVACY",
  "MANAGE_SHARE_LINKS",
  "DELETE_PERSON",
  "DELETE_MEDIA",
  "DELETE_EVIDENCE",
  "DELETE_FAMILY",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Access context — roles are NEVER trusted from the caller.
 * Membership role must be loaded from DB.
 */
export type AccessContext =
  | { kind: "ANONYMOUS" }
  | { kind: "USER"; userId: string }
  | { kind: "SHARE_LINK"; rawToken: string }
  | { kind: "USER_AND_SHARE_LINK"; userId: string; rawToken: string };

export type Decision = "ALLOW" | "DENY";

export type FamilyPolicyInput = {
  familyVisibility: FamilyVisibility;
  familyDeleted: boolean;
  /** ACTIVE membership role, or null if none / suspended */
  activeRole: MembershipRole | null;
  validShareLink: boolean;
  action: PermissionAction;
};

export type PersonPolicyInput = FamilyPolicyInput & {
  privacyLevel: PrivacyLevel;
  livingStatus: LivingStatus;
  personDeleted: boolean;
};

export type MediaPolicyInput = FamilyPolicyInput & {
  mediaVisibility: import("@/db/constants").MediaVisibility;
  /** Only ACTIVE media is readable */
  mediaActive: boolean;
};

export type EvidencePolicyInput = FamilyPolicyInput & {
  evidenceVisibility: import("@/db/constants").EvidenceVisibility;
  /** Soft-deleted evidence is never readable */
  evidenceActive: boolean;
};

export type EffectivePersonAccess =
  | "OWNER_ADMIN_ONLY"
  | "FAMILY_MEMBERS"
  | "LINK_OR_PUBLIC"
  | "PUBLIC";
