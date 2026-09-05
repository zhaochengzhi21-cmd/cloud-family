/**
 * Pure permission policy — no DB, no secrets.
 * Family visibility is a ceiling; living/UNKNOWN INHERIT → FAMILY.
 */

import type { LivingStatus, MembershipRole, PrivacyLevel } from "@/db/constants";
import type {
  Decision,
  FamilyPolicyInput,
  PermissionAction,
  PersonPolicyInput,
} from "./types";

const CONTENT_EDIT_ACTIONS: PermissionAction[] = [
  "EDIT_PERSON",
  "EDIT_RELATIONSHIP",
  "EDIT_CLAIM",
  "EDIT_EVIDENCE",
  "UPLOAD_MEDIA",
];

function roleAllowsAction(
  role: MembershipRole,
  action: PermissionAction
): boolean {
  switch (role) {
    case "OWNER":
      return true;
    case "ADMIN":
      return action !== "DELETE_FAMILY";
    case "EDITOR":
      return (
        action === "READ_FAMILY" ||
        action === "READ_PERSON" ||
        CONTENT_EDIT_ACTIONS.includes(action)
      );
    case "VIEWER":
      return action === "READ_FAMILY" || action === "READ_PERSON";
    default:
      return false;
  }
}

/**
 * Can this actor read the family identity/shell (not person content)?
 * discoveryEnabled is intentionally ignored — never opens READ.
 */
export function canReadFamily(input: {
  familyVisibility: FamilyPolicyInput["familyVisibility"];
  familyDeleted: boolean;
  activeRole: MembershipRole | null;
  validShareLink: boolean;
}): Decision {
  if (input.familyDeleted) return "DENY";

  if (input.activeRole) return "ALLOW";

  switch (input.familyVisibility) {
    case "PRIVATE":
      return "DENY";
    case "LINK":
      return input.validShareLink ? "ALLOW" : "DENY";
    case "PUBLIC":
      return "ALLOW";
    default:
      return "DENY";
  }
}

export function decideFamilyAction(input: FamilyPolicyInput): Decision {
  if (input.familyDeleted) return "DENY";

  if (input.action === "READ_FAMILY") {
    return canReadFamily(input);
  }

  // Mutations require ACTIVE membership role from DB
  if (!input.activeRole) return "DENY";
  return roleAllowsAction(input.activeRole, input.action) ? "ALLOW" : "DENY";
}

/**
 * Resolve effective person access after living/INHERIT rules and family ceiling.
 */
export function resolveEffectivePersonAccess(input: {
  familyVisibility: FamilyPolicyInput["familyVisibility"];
  privacyLevel: PrivacyLevel;
  livingStatus: LivingStatus;
}): "OWNER_ADMIN_ONLY" | "FAMILY_MEMBERS" | "SHARE_OR_PUBLIC" | "PUBLIC_ONLY" {
  let privacy = input.privacyLevel;

  if (privacy === "INHERIT") {
    if (
      input.livingStatus === "LIVING" ||
      input.livingStatus === "UNKNOWN"
    ) {
      privacy = "FAMILY";
    } else {
      // DECEASED + INHERIT → inherit family visibility
      if (input.familyVisibility === "PRIVATE") return "FAMILY_MEMBERS";
      if (input.familyVisibility === "LINK") return "SHARE_OR_PUBLIC";
      return "PUBLIC_ONLY";
    }
  }

  // Explicit privacy still cannot exceed family ceiling
  if (privacy === "PRIVATE") return "OWNER_ADMIN_ONLY";
  if (privacy === "FAMILY") return "FAMILY_MEMBERS";

  // privacy === PUBLIC, apply family ceiling
  if (input.familyVisibility === "PRIVATE") return "FAMILY_MEMBERS";
  if (input.familyVisibility === "LINK") return "SHARE_OR_PUBLIC";
  return "PUBLIC_ONLY";
}

export function decidePersonRead(input: PersonPolicyInput): Decision {
  if (input.familyDeleted || input.personDeleted) return "DENY";

  const effective = resolveEffectivePersonAccess(input);

  switch (effective) {
    case "OWNER_ADMIN_ONLY":
      return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
        ? "ALLOW"
        : "DENY";
    case "FAMILY_MEMBERS":
      return input.activeRole ? "ALLOW" : "DENY";
    case "SHARE_OR_PUBLIC":
      if (input.activeRole) return "ALLOW";
      return input.validShareLink ? "ALLOW" : "DENY";
    case "PUBLIC_ONLY":
      return "ALLOW";
    default:
      return "DENY";
  }
}

export function decidePersonAction(input: PersonPolicyInput): Decision {
  if (input.action === "READ_PERSON") {
    return decidePersonRead(input);
  }
  // Person mutations use same role matrix as family content actions,
  // but still require the family to be accessible as a member.
  if (input.familyDeleted || input.personDeleted) return "DENY";
  if (!input.activeRole) return "DENY";
  return roleAllowsAction(input.activeRole, input.action) ? "ALLOW" : "DENY";
}
