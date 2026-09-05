import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";

/**
 * Claim = asserted fact about FAMILY | PERSON | RELATIONSHIP.
 * subject_id is polymorphic — no cross-table FK (integrity at app layer).
 */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    claimType: text("claim_type").notNull(),
    valueJson: jsonb("value_json").notNull(),
    normalizedJson: jsonb("normalized_json"),
    status: text("status").notNull().default("PROPOSED"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    familyIdx: index("claims_family_id_idx").on(t.familyId),
    subjectIdx: index("claims_subject_id_idx").on(t.subjectId),
    claimTypeIdx: index("claims_claim_type_idx").on(t.claimType),
    statusIdx: index("claims_status_idx").on(t.status),
    subjectTypeCk: check(
      "claims_subject_type_ck",
      sql`${t.subjectType} IN ('FAMILY', 'PERSON', 'RELATIONSHIP')`
    ),
    statusCk: check(
      "claims_status_ck",
      sql`${t.status} IN ('PROPOSED', 'ACCEPTED', 'CONFLICTED', 'REJECTED')`
    ),
    confidenceCk: check(
      "claims_confidence_ck",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`
    ),
  })
);
