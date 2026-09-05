import type { RelationshipType } from "@/db/constants";
import type { AccessContext } from "@/v1/domain/permission/types";

export type RelationshipView = {
  id: string;
  familyId: string;
  fromPersonId: string;
  toPersonId: string;
  relationshipType: RelationshipType;
  status: "ACCEPTED";
  createdAt: Date;
  updatedAt: Date;
};

export type CreateRelationshipInput = {
  familyId: string;
  actorContext: AccessContext;
  /** Semantic endpoints before normalization / direction rules. */
  personAId: string;
  personBId: string;
  /**
   * For parent types: personAId = PARENT, personBId = CHILD.
   * For SPOUSE: undirected; stored after canonical UUID order.
   */
  relationshipType: RelationshipType;
};

export type CreateRelationshipResult = {
  relationship: RelationshipView;
  familyVersion: number;
};

export type DeleteRelationshipResult = {
  relationshipId: string;
  familyVersion: number;
};

export const PARENT_RELATIONSHIP_TYPES: RelationshipType[] = [
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
];

export function isParentRelationshipType(t: RelationshipType): boolean {
  return PARENT_RELATIONSHIP_TYPES.includes(t);
}
