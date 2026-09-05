import type { ClaimType } from "@/db/constants";
import type { ClaimCardinality } from "./types";

export type ClaimTypeDefinition = {
  type: ClaimType;
  cardinality: ClaimCardinality;
  kind: "TEXTUAL" | "RELATIONSHIP_ASSERTION";
};

const REGISTRY: Record<ClaimType, ClaimTypeDefinition> = {
  BIRTH_DATE: {
    type: "BIRTH_DATE",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  DEATH_DATE: {
    type: "DEATH_DATE",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  BIRTH_PLACE: {
    type: "BIRTH_PLACE",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  ANCESTRAL_PLACE: {
    type: "ANCESTRAL_PLACE",
    cardinality: "MULTI",
    kind: "TEXTUAL",
  },
  BURIAL_PLACE: {
    type: "BURIAL_PLACE",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  GENERATION_WORD: {
    type: "GENERATION_WORD",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  MIGRATION: { type: "MIGRATION", cardinality: "MULTI", kind: "TEXTUAL" },
  ALIAS: { type: "ALIAS", cardinality: "MULTI", kind: "TEXTUAL" },
  OCCUPATION: { type: "OCCUPATION", cardinality: "MULTI", kind: "TEXTUAL" },
  HALL_NAME: {
    type: "HALL_NAME",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  BRANCH_NAME: {
    type: "BRANCH_NAME",
    cardinality: "SINGLETON",
    kind: "TEXTUAL",
  },
  RELATIONSHIP_ASSERTION: {
    type: "RELATIONSHIP_ASSERTION",
    cardinality: "MULTI",
    kind: "RELATIONSHIP_ASSERTION",
  },
};

export function getClaimTypeDefinition(
  claimType: string
): ClaimTypeDefinition | null {
  if (!(claimType in REGISTRY)) return null;
  return REGISTRY[claimType as ClaimType];
}

export function isRegisteredClaimType(claimType: string): claimType is ClaimType {
  return claimType in REGISTRY;
}

export function listRegisteredClaimTypes(): ClaimType[] {
  return Object.keys(REGISTRY) as ClaimType[];
}

export function listSingletonClaimTypes(): ClaimType[] {
  return listRegisteredClaimTypes().filter(
    (t) => REGISTRY[t].cardinality === "SINGLETON"
  );
}

export function listMultiClaimTypes(): ClaimType[] {
  return listRegisteredClaimTypes().filter(
    (t) => REGISTRY[t].cardinality === "MULTI"
  );
}
