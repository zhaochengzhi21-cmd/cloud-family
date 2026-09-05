import {
  LIVING_STATUS,
  PERSON_GENDER,
  PRIVACY_LEVEL,
  type LivingStatus,
  type PersonGender,
  type PrivacyLevel,
} from "@/db/constants";
import { PersonDomainError } from "./errors";
import type { CreatePersonInput, UpdatePersonInput } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new PersonDomainError("INVALID_INPUT", `${field} must be a UUID`);
  }
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function validatePreferredName(raw: string): string {
  if (typeof raw !== "string") {
    throw new PersonDomainError("INVALID_INPUT", "preferredName required");
  }
  const name = raw.trim();
  if (!name || name.length < 1 || name.length > 120) {
    throw new PersonDomainError(
      "INVALID_INPUT",
      "preferredName must be 1–120 chars after trim"
    );
  }
  if (hasControlChars(name)) {
    throw new PersonDomainError(
      "INVALID_INPUT",
      "preferredName must not contain control characters"
    );
  }
  return name;
}

function assertGender(g: string): PersonGender {
  if (!(PERSON_GENDER as readonly string[]).includes(g)) {
    throw new PersonDomainError("INVALID_INPUT", "invalid gender");
  }
  return g as PersonGender;
}

function assertLiving(s: string): LivingStatus {
  if (!(LIVING_STATUS as readonly string[]).includes(s)) {
    throw new PersonDomainError("INVALID_INPUT", "invalid livingStatus");
  }
  return s as LivingStatus;
}

function assertPrivacy(p: string): PrivacyLevel {
  if (!(PRIVACY_LEVEL as readonly string[]).includes(p)) {
    throw new PersonDomainError("INVALID_INPUT", "invalid privacyLevel");
  }
  return p as PrivacyLevel;
}

export type ValidatedCreatePerson = {
  familyId: string;
  preferredName: string;
  gender: PersonGender;
  livingStatus: LivingStatus;
  privacyLevel: PrivacyLevel;
};

export function validateCreatePersonInput(
  input: CreatePersonInput
): ValidatedCreatePerson {
  assertUuid(input.familyId, "familyId");
  return {
    familyId: input.familyId,
    preferredName: validatePreferredName(input.preferredName),
    gender: input.gender !== undefined ? assertGender(input.gender) : "UNKNOWN",
    livingStatus:
      input.livingStatus !== undefined
        ? assertLiving(input.livingStatus)
        : "UNKNOWN",
    privacyLevel:
      input.privacyLevel !== undefined
        ? assertPrivacy(input.privacyLevel)
        : "INHERIT",
  };
}

export type ValidatedUpdatePerson = {
  personId: string;
  expectedRevision: number;
  preferredName?: string;
  gender?: PersonGender;
  livingStatus?: LivingStatus;
  privacyLevel?: PrivacyLevel;
};

export function validateUpdatePersonInput(
  input: UpdatePersonInput
): ValidatedUpdatePerson {
  assertUuid(input.personId, "personId");
  if (
    typeof input.expectedRevision !== "number" ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new PersonDomainError("INVALID_INPUT", "expectedRevision invalid");
  }
  const out: ValidatedUpdatePerson = {
    personId: input.personId,
    expectedRevision: input.expectedRevision,
  };
  if (input.preferredName !== undefined) {
    out.preferredName = validatePreferredName(input.preferredName);
  }
  if (input.gender !== undefined) out.gender = assertGender(input.gender);
  if (input.livingStatus !== undefined) {
    out.livingStatus = assertLiving(input.livingStatus);
  }
  if (input.privacyLevel !== undefined) {
    out.privacyLevel = assertPrivacy(input.privacyLevel);
  }
  return out;
}
