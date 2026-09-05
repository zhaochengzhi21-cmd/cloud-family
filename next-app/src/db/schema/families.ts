import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Stable Family Identity (UUID). Not CID / Polygon bytes32.
 * visibility and discovery_enabled are independent.
 */
export const families = pgTable(
  "families",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name").notNull(),
    surname: text("surname"),
    visibility: text("visibility").notNull().default("PRIVATE"),
    discoveryEnabled: boolean("discovery_enabled").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentVersionNo: integer("current_version_no").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    createdByIdx: index("families_created_by_user_id_idx").on(t.createdByUserId),
    visibilityCk: check(
      "families_visibility_ck",
      sql`${t.visibility} IN ('PRIVATE', 'LINK', 'PUBLIC')`
    ),
    currentVersionCk: check(
      "families_current_version_no_ck",
      sql`${t.currentVersionNo} >= 0`
    ),
  })
);

export const familyMemberships = pgTable(
  "family_memberships",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    familyUserUq: uniqueIndex("family_memberships_family_user_uq").on(
      t.familyId,
      t.userId
    ),
    userIdx: index("family_memberships_user_id_idx").on(t.userId),
    familyIdx: index("family_memberships_family_id_idx").on(t.familyId),
    roleCk: check(
      "family_memberships_role_ck",
      sql`${t.role} IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')`
    ),
    statusCk: check(
      "family_memberships_status_ck",
      sql`${t.status} IN ('ACTIVE', 'SUSPENDED')`
    ),
    /** At most one ACTIVE OWNER per family (at-least-one enforced by create/transfer txs). */
    oneActiveOwnerUq: uniqueIndex("family_memberships_one_active_owner_uq")
      .on(t.familyId)
      .where(sql`${t.role} = 'OWNER' AND ${t.status} = 'ACTIVE'`),
  })
);
