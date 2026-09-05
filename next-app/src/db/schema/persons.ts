import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";

/**
 * Genealogy person — not a User account.
 * No father_id / mother_id / spouse_id columns: relationships table is sole truth.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    preferredName: text("preferred_name").notNull(),
    gender: text("gender").notNull().default("UNKNOWN"),
    livingStatus: text("living_status").notNull().default("UNKNOWN"),
    privacyLevel: text("privacy_level").notNull().default("INHERIT"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    familyIdx: index("persons_family_id_idx").on(t.familyId),
    livingStatusIdx: index("persons_living_status_idx").on(t.livingStatus),
    genderCk: check(
      "persons_gender_ck",
      sql`${t.gender} IN ('MALE', 'FEMALE', 'UNKNOWN', 'OTHER')`
    ),
    livingCk: check(
      "persons_living_status_ck",
      sql`${t.livingStatus} IN ('LIVING', 'DECEASED', 'UNKNOWN')`
    ),
    privacyCk: check(
      "persons_privacy_level_ck",
      sql`${t.privacyLevel} IN ('INHERIT', 'PRIVATE', 'FAMILY', 'PUBLIC')`
    ),
  })
);
