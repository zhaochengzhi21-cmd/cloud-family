/**
 * Pure permission policy — no DB, no secrets.
 * Family visibility is a ceiling; living/UNKNOWN INHERIT → FAMILY.
 */

import type {
  LivingStatus,
  MembershipRole,
  PrivacyLevel,
} from "@/db/constants";
import type {
  Decision,
  EvidencePolicyInput,
  FamilyPolicyInput,
  MediaPolicyInput,
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
        action === "READ_MEDIA" ||
        action === "READ_EVIDENCE" ||
        CONTENT_EDIT_ACTIONS.includes(action)
      );
    case "VIEWER":
      return (
        action === "READ_FAMILY" ||
        action === "READ_PERSON" ||
        action === "READ_MEDIA" ||
        action === "READ_EVIDENCE"
      );
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

  // DELETE_MEDIA / DELETE_EVIDENCE: OWNER / ADMIN only
  if (input.action === "DELETE_MEDIA" || input.action === "DELETE_EVIDENCE") {
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }

  // REVIEW_CLAIM: OWNER / ADMIN only (EDITOR DENY)
  if (input.action === "REVIEW_CLAIM") {
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }

  return roleAllowsAction(input.activeRole, input.action) ? "ALLOW" : "DENY";
}

/**
 * Media READ after Family ceiling + Media visibility.
 * Non-ACTIVE media is never readable.
 */
export function decideMediaRead(input: MediaPolicyInput): Decision {
  if (input.familyDeleted || !input.mediaActive) return "DENY";

  const vis = input.mediaVisibility;

  if (vis === "PRIVATE") {
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }

  if (vis === "FAMILY") {
    return input.activeRole ? "ALLOW" : "DENY";
  }

  // MEDIA PUBLIC — still under Family visibility ceiling
  if (input.familyVisibility === "PRIVATE") {
    return input.activeRole ? "ALLOW" : "DENY";
  }
  if (input.familyVisibility === "LINK") {
    if (input.activeRole) return "ALLOW";
    return input.validShareLink ? "ALLOW" : "DENY";
  }
  // Family PUBLIC + Media PUBLIC
  return "ALLOW";
}

export function decideMediaAction(input: MediaPolicyInput): Decision {
  if (input.action === "READ_MEDIA") {
    return decideMediaRead(input);
  }
  if (input.action === "DELETE_MEDIA") {
    if (input.familyDeleted) return "DENY";
    if (!input.activeRole) return "DENY";
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }
  return "DENY";
}

/**
 * Evidence base visibility (orphan / subject / media ceilings applied in service).
 */
export function decideEvidenceRead(input: EvidencePolicyInput): Decision {
  if (input.familyDeleted || !input.evidenceActive) return "DENY";

  const vis = input.evidenceVisibility;

  if (vis === "PRIVATE") {
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }

  if (vis === "FAMILY") {
    return input.activeRole ? "ALLOW" : "DENY";
  }

  // Evidence PUBLIC — Family visibility ceiling (extra subject/media rules in service)
  if (input.familyVisibility === "PRIVATE") {
    return input.activeRole ? "ALLOW" : "DENY";
  }
  if (input.familyVisibility === "LINK") {
    if (input.activeRole) return "ALLOW";
    return input.validShareLink ? "ALLOW" : "DENY";
  }
  return "ALLOW";
}

export function decideEvidenceAction(input: EvidencePolicyInput): Decision {
  if (input.action === "READ_EVIDENCE") {
    return decideEvidenceRead(input);
  }
  if (input.action === "DELETE_EVIDENCE") {
    if (input.familyDeleted || !input.evidenceActive) return "DENY";
    if (!input.activeRole) return "DENY";
    return input.activeRole === "OWNER" || input.activeRole === "ADMIN"
      ? "ALLOW"
      : "DENY";
  }
  return "DENY";
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
