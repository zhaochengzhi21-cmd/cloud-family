/**
 * Zod HTTP schemas for Workspace API — not a Domain validation substitute.
 */

import { z } from "zod";

const uuid = z.string().uuid();

export const createFamilyBodySchema = z
  .object({
    displayName: z.string().min(1).max(120),
    surname: z.string().max(50).nullable().optional(),
    visibility: z.enum(["PRIVATE", "LINK", "PUBLIC"]).optional(),
    discoveryEnabled: z.boolean().optional(),
  })
  .strict();

export const patchFamilyBodySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().min(1).max(120).optional(),
    surname: z.string().max(50).nullable().optional(),
    visibility: z.enum(["PRIVATE", "LINK", "PUBLIC"]).optional(),
    discoveryEnabled: z.boolean().optional(),
  })
  .strict();

export const createPersonBodySchema = z
  .object({
    preferredName: z.string().min(1).max(120),
    gender: z.enum(["MALE", "FEMALE", "UNKNOWN", "OTHER"]).optional(),
    livingStatus: z.enum(["LIVING", "DECEASED", "UNKNOWN"]).optional(),
    privacyLevel: z.enum(["INHERIT", "PRIVATE", "FAMILY", "PUBLIC"]).optional(),
  })
  .strict();

export const patchPersonBodySchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    preferredName: z.string().min(1).max(120).optional(),
    gender: z.enum(["MALE", "FEMALE", "UNKNOWN", "OTHER"]).optional(),
    livingStatus: z.enum(["LIVING", "DECEASED", "UNKNOWN"]).optional(),
    privacyLevel: z.enum(["INHERIT", "PRIVATE", "FAMILY", "PUBLIC"]).optional(),
  })
  .strict();

export const createRelationshipBodySchema = z
  .object({
    fromPersonId: uuid,
    toPersonId: uuid,
    relationshipType: z.enum([
      "BIOLOGICAL_PARENT",
      "ADOPTIVE_PARENT",
      "STEP_PARENT",
      "SPOUSE",
    ]),
  })
  .strict();

export const createClaimBodySchema = z
  .object({
    subjectType: z.enum(["FAMILY", "PERSON", "RELATIONSHIP"]),
    subjectId: uuid,
    claimType: z.string().min(1).max(64),
    value: z.unknown(),
    originType: z.literal("MANUAL").optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const forbidden = [
      "normalizedJson",
      "valueFingerprint",
      "status",
      "reviewedBy",
      "reviewedAt",
    ];
    // body already .strict() — extra guard if caller used passthrough elsewhere
    for (const k of forbidden) {
      if (k in val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `forbidden field ${k}`,
        });
      }
    }
  });

export const createEvidenceBodySchema = z
  .object({
    evidenceType: z.enum([
      "GENEALOGY_PAGE",
      "PHOTO",
      "TOMBSTONE",
      "ORAL_HISTORY",
      "DOCUMENT",
      "ARCHIVE",
      "USER_TESTIMONY",
      "OTHER",
    ]),
    title: z.string().max(200).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    sourceLocator: z.string().max(500).nullable().optional(),
    sourceDateText: z.string().max(200).nullable().optional(),
    visibility: z.enum(["PRIVATE", "FAMILY", "PUBLIC"]).optional(),
    mediaObjectId: uuid.nullable().optional(),
  })
  .strict();

export const linkEvidenceBodySchema = z
  .object({
    evidenceId: uuid,
    relation: z.enum(["SUPPORTS", "CONTRADICTS", "CONTEXT"]),
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();

export const familyIdParamSchema = uuid;
