import {
  FAMILY_VISIBILITY,
  type FamilyVisibility,
} from "@/db/constants";
import { FamilyDomainError } from "./errors";
import type { CreateFamilyInput, UpdateFamilyIdentityInput } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DISPLAY_NAME_MAX = 120;
export const SURNAME_MAX = 50;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      `${field} must be a valid UUID`
    );
  }
}

export function normalizeDisplayName(raw: string): string {
  const displayName = raw.trim();
  if (!displayName) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      "displayName must not be empty"
    );
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      `displayName must be at most ${DISPLAY_NAME_MAX} characters`
    );
  }
  return displayName;
}

/** Empty / whitespace surname → null. */
export function normalizeSurname(
  raw: string | null | undefined
): string | null {
  if (raw === undefined || raw === null) return null;
  const surname = raw.trim();
  if (!surname) return null;
  if (surname.length > SURNAME_MAX) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      `surname must be at most ${SURNAME_MAX} characters`
    );
  }
  return surname;
}

export function assertVisibility(value: string): asserts value is FamilyVisibility {
  if (!(FAMILY_VISIBILITY as readonly string[]).includes(value)) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      `visibility must be one of ${FAMILY_VISIBILITY.join(", ")}`
    );
  }
}

export function validateCreateFamilyInput(input: CreateFamilyInput): {
  ownerUserId: string;
  displayName: string;
  surname: string | null;
  visibility: FamilyVisibility;
  discoveryEnabled: boolean;
} {
  assertUuid(input.ownerUserId, "ownerUserId");
  const displayName = normalizeDisplayName(input.displayName);
  const surname = normalizeSurname(input.surname);
  const visibility = input.visibility ?? "PRIVATE";
  assertVisibility(visibility);
  const discoveryEnabled = input.discoveryEnabled ?? false;
  if (typeof discoveryEnabled !== "boolean") {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      "discoveryEnabled must be boolean"
    );
  }
  return {
    ownerUserId: input.ownerUserId,
    displayName,
    surname,
    visibility,
    discoveryEnabled,
  };
}

export function validateUpdateFamilyIdentityInput(
  input: UpdateFamilyIdentityInput
): {
  familyId: string;
  actorUserId: string;
  expectedVersion: number;
  displayName?: string;
  surname?: string | null;
  visibility?: FamilyVisibility;
  discoveryEnabled?: boolean;
} {
  assertUuid(input.familyId, "familyId");
  assertUuid(input.actorUserId, "actorUserId");
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new FamilyDomainError(
      "INVALID_INPUT",
      "expectedVersion must be an integer >= 1"
    );
  }

  const out: {
    familyId: string;
    actorUserId: string;
    expectedVersion: number;
    displayName?: string;
    surname?: string | null;
    visibility?: FamilyVisibility;
    discoveryEnabled?: boolean;
  } = {
    familyId: input.familyId,
    actorUserId: input.actorUserId,
    expectedVersion: input.expectedVersion,
  };

  if (input.displayName !== undefined) {
    out.displayName = normalizeDisplayName(input.displayName);
  }
  if (input.surname !== undefined) {
    out.surname = normalizeSurname(input.surname);
  }
  if (input.visibility !== undefined) {
    assertVisibility(input.visibility);
    out.visibility = input.visibility;
  }
  if (input.discoveryEnabled !== undefined) {
    if (typeof input.discoveryEnabled !== "boolean") {
      throw new FamilyDomainError(
        "INVALID_INPUT",
        "discoveryEnabled must be boolean"
      );
    }
    out.discoveryEnabled = input.discoveryEnabled;
  }

  return out;
}
