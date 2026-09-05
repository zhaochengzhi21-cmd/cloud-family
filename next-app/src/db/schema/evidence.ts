import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";
import { mediaObjects } from "./media";
import { claims } from "./claims";

/**
 * Evidence sources. description may hold private info — do not full-text index.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    evidenceType: text("evidence_type").notNull(),
    title: text("title"),
    description: text("description"),
    mediaObjectId: uuid("media_object_id").references(() => mediaObjects.id, {
      onDelete: "set null",
    }),
    sourceLocator: text("source_locator"),
    sourceDateText: text("source_date_text"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    familyIdx: index("evidence_family_id_idx").on(t.familyId),
    mediaIdx: index("evidence_media_object_id_idx").on(t.mediaObjectId),
    typeCk: check(
      "evidence_type_ck",
      sql`${t.evidenceType} IN ('GENEALOGY_PAGE', 'PHOTO', 'TOMBSTONE', 'ORAL_HISTORY', 'DOCUMENT', 'ARCHIVE', 'USER_TESTIMONY', 'OTHER')`
    ),
  })
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    relation: text("relation").notNull().default("SUPPORTS"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.claimId, t.evidenceId] }),
    relationCk: check(
      "claim_evidence_relation_ck",
      sql`${t.relation} IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT')`
    ),
  })
);
