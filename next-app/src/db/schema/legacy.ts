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

/**
 * Migration bridge from Legacy V0 → V1 stable family IDs.
 * legacy_family_id is NOT assumed unique (V0 version semantics were messy).
 */
export const legacyFamilyMaps = pgTable(
  "legacy_family_maps",
  {
    id: uuid("id").primaryKey(),
    legacyFamilyId: text("legacy_family_id"),
    legacyIpfsCid: text("legacy_ipfs_cid"),
    newFamilyId: uuid("new_family_id").references(() => families.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("V0"),
    migrationStatus: text("migration_status").notNull().default("PENDING"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    legacyFamilyIdx: index("legacy_family_maps_legacy_family_id_idx").on(
      t.legacyFamilyId
    ),
    legacyCidIdx: index("legacy_family_maps_legacy_ipfs_cid_idx").on(
      t.legacyIpfsCid
    ),
    newFamilyIdx: index("legacy_family_maps_new_family_id_idx").on(t.newFamilyId),
    statusCk: check(
      "legacy_family_maps_status_ck",
      sql`${t.migrationStatus} IN ('PENDING', 'DISCOVERED', 'MIGRATED', 'ARCHIVED', 'FAILED')`
    ),
  })
);
