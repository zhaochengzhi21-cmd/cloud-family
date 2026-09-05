import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";

/**
 * Immutable family version history.
 * snapshot_json is export/history material — NOT the live truth source.
 */
export const familyVersions = pgTable(
  "family_versions",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    schemaVersion: integer("schema_version").notNull().default(1),
    summary: text("summary"),
    contentHash: text("content_hash"),
    snapshotJson: jsonb("snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    familyVersionUq: uniqueIndex("family_versions_family_version_uq").on(
      t.familyId,
      t.versionNo
    ),
    familyIdx: index("family_versions_family_id_idx").on(t.familyId),
    versionNoCk: check(
      "family_versions_version_no_ck",
      sql`${t.versionNo} > 0`
    ),
  })
);
