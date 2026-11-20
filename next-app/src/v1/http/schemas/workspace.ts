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

const createPersonBatchItemSchema = z
  .object({
    preferredName: z.string().min(1).max(120),
    gender: z.enum(["MALE", "FEMALE", "UNKNOWN", "OTHER"]).optional(),
    livingStatus: z.enum(["LIVING", "DECEASED", "UNKNOWN"]).optional(),
    privacyLevel: z.enum(["INHERIT", "PRIVATE", "FAMILY", "PUBLIC"]).optional(),
    clientItemId: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Batch create persons — AI/import friendly; max 20. */
export const createPersonsBatchBodySchema = z
  .object({
    persons: z.array(createPersonBatchItemSchema).min(1).max(20),
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

const createRelationshipBatchItemSchema = z
  .object({
    fromPersonId: uuid,
    toPersonId: uuid,
    relationshipType: z.enum([
      "BIOLOGICAL_PARENT",
      "ADOPTIVE_PARENT",
      "STEP_PARENT",
      "SPOUSE",
    ]),
    clientItemId: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Batch create edges — AI/import friendly; max 20. */
export const createRelationshipsBatchBodySchema = z
  .object({
    relationships: z.array(createRelationshipBatchItemSchema).min(1).max(20),
    onDuplicate: z.enum(["error", "reuse"]).optional(),
  })
  .strict();

export const createClaimBodySchema = z
  .object({
    subjectType: z.enum(["FAMILY", "PERSON", "RELATIONSHIP"]),
    subjectId: uuid,
    claimType: z.string().min(1).max(64),
    value: z.unknown(),
    /** MANUAL (default), AI_EXTRACTION / IMPORT for agent drafts — always PROPOSED. */
    originType: z
      .enum(["MANUAL", "AI_EXTRACTION", "IMPORT"])
      .optional(),
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

const createClaimBatchItemSchema = z
  .object({
    subjectType: z.enum(["FAMILY", "PERSON", "RELATIONSHIP"]),
    subjectId: uuid,
    claimType: z.string().min(1).max(64),
    value: z
      .object({ text: z.string().min(1).max(8000) })
      .passthrough(),
    originType: z
      .enum(["MANUAL", "AI_EXTRACTION", "IMPORT"])
      .optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    clientItemId: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Batch propose — AI/agent friendly; max 20 items. */
export const createClaimsBatchBodySchema = z
  .object({
    claims: z.array(createClaimBatchItemSchema).min(1).max(20),
    /** reuse (default): duplicate fingerprint returns existing claim. */
    onDuplicate: z.enum(["error", "reuse"]).optional(),
  })
  .strict();

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

/** One source → many claims (OCR page / import). */
export const linkEvidenceBatchBodySchema = z
  .object({
    claimIds: z.array(uuid).min(1).max(20),
    relation: z.enum(["SUPPORTS", "CONTRADICTS", "CONTEXT"]).optional(),
    onDuplicate: z.enum(["error", "reuse"]).optional(),
  })
  .strict();

/** Composite OCR/page propose — persons + edges + claims + optional source. */
export const agentProposeBodySchema = z
  .object({
    originType: z.enum(["AI_EXTRACTION", "IMPORT"]).optional(),
    persons: z.array(createPersonBatchItemSchema).max(20).optional(),
    relationships: z
      .array(
        z
          .object({
            fromPersonId: uuid.optional(),
            toPersonId: uuid.optional(),
            fromClientItemId: z.string().min(1).max(64).optional(),
            toClientItemId: z.string().min(1).max(64).optional(),
            relationshipType: z.enum([
              "BIOLOGICAL_PARENT",
              "ADOPTIVE_PARENT",
              "STEP_PARENT",
              "SPOUSE",
            ]),
            clientItemId: z.string().min(1).max(64).optional(),
          })
          .strict()
          .superRefine((v, ctx) => {
            if (!v.fromPersonId && !v.fromClientItemId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "fromPersonId or fromClientItemId required",
              });
            }
            if (!v.toPersonId && !v.toClientItemId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "toPersonId or toClientItemId required",
              });
            }
          })
      )
      .max(20)
      .optional(),
    claims: z
      .array(
        z
          .object({
            subjectId: uuid.optional(),
            subjectClientItemId: z.string().min(1).max(64).optional(),
            claimType: z.string().min(1).max(64),
            value: z
              .object({ text: z.string().min(1).max(8000) })
              .passthrough(),
            confidence: z.number().min(0).max(1).nullable().optional(),
            clientItemId: z.string().min(1).max(64).optional(),
          })
          .strict()
          .superRefine((v, ctx) => {
            if (!v.subjectId && !v.subjectClientItemId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "subjectId or subjectClientItemId required",
              });
            }
          })
      )
      .max(20)
      .optional(),
    evidence: z
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
        claimClientItemIds: z.array(z.string().min(1).max(64)).max(20).optional(),
        claimIds: z.array(uuid).max(20).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const empty =
      !(v.persons && v.persons.length) &&
      !(v.relationships && v.relationships.length) &&
      !(v.claims && v.claims.length) &&
      !v.evidence;
    if (empty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "package must include persons, relationships, claims, or evidence",
      });
    }
  });

export const emptyBodySchema = z.object({}).strict();

export const familyIdParamSchema = uuid;
