/**
 * V1 domain constants — application enums (not all mirrored as DB enums).
 * claim_type is intentionally text + constants (fast expansion).
 */

export const FAMILY_VISIBILITY = ["PRIVATE", "LINK", "PUBLIC"] as const;
export type FamilyVisibility = (typeof FAMILY_VISIBILITY)[number];

export const MEMBERSHIP_ROLE = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLE)[number];

export const MEMBERSHIP_STATUS = ["ACTIVE", "SUSPENDED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];

export const PERSON_GENDER = ["MALE", "FEMALE", "UNKNOWN", "OTHER"] as const;
export type PersonGender = (typeof PERSON_GENDER)[number];

export const LIVING_STATUS = ["LIVING", "DECEASED", "UNKNOWN"] as const;
export type LivingStatus = (typeof LIVING_STATUS)[number];

export const PRIVACY_LEVEL = ["INHERIT", "PRIVATE", "FAMILY", "PUBLIC"] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVEL)[number];

/**
 * Relationship direction (hard rule):
 * BIOLOGICAL_PARENT / ADOPTIVE_PARENT / STEP_PARENT: from = parent, to = child
 * SPOUSE: undirected pair stored once; from/to order is application-defined
 */
export const RELATIONSHIP_TYPE = [
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
  "SPOUSE",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPE)[number];

export const RELATIONSHIP_STATUS = [
  "PROPOSED",
  "ACCEPTED",
  "DISPUTED",
  "REJECTED",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUS)[number];

export const MEDIA_STORAGE_PROVIDER = ["LEGACY_IPFS", "PRIVATE_OBJECT"] as const;
export type MediaStorageProvider = (typeof MEDIA_STORAGE_PROVIDER)[number];

export const MEDIA_VISIBILITY = ["PRIVATE", "FAMILY", "PUBLIC"] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITY)[number];

export const MEDIA_STATUS = ["ACTIVE", "DELETED"] as const;
export type MediaStatus = (typeof MEDIA_STATUS)[number];

export const CLAIM_SUBJECT_TYPE = ["FAMILY", "PERSON", "RELATIONSHIP"] as const;
export type ClaimSubjectType = (typeof CLAIM_SUBJECT_TYPE)[number];

/** Predefined claim types — DB stores free text; expand in app constants. */
export const CLAIM_TYPE = [
  "BIRTH_DATE",
  "DEATH_DATE",
  "BIRTH_PLACE",
  "ANCESTRAL_PLACE",
  "BURIAL_PLACE",
  "GENERATION_WORD",
  "MIGRATION",
  "ALIAS",
  "OCCUPATION",
  "RELATIONSHIP_ASSERTION",
  "HALL_NAME",
  "BRANCH_NAME",
] as const;
export type ClaimType = (typeof CLAIM_TYPE)[number];

export const CLAIM_STATUS = [
  "PROPOSED",
  "ACCEPTED",
  "CONFLICTED",
  "REJECTED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUS)[number];

export const EVIDENCE_TYPE = [
  "GENEALOGY_PAGE",
  "PHOTO",
  "TOMBSTONE",
  "ORAL_HISTORY",
  "DOCUMENT",
  "ARCHIVE",
  "USER_TESTIMONY",
  "OTHER",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPE)[number];

export const CLAIM_EVIDENCE_RELATION = [
  "SUPPORTS",
  "CONTRADICTS",
  "CONTEXT",
] as const;
export type ClaimEvidenceRelation = (typeof CLAIM_EVIDENCE_RELATION)[number];

export const LEGACY_MIGRATION_STATUS = [
  "PENDING",
  "DISCOVERED",
  "MIGRATED",
  "ARCHIVED",
  "FAILED",
] as const;
export type LegacyMigrationStatus = (typeof LEGACY_MIGRATION_STATUS)[number];
