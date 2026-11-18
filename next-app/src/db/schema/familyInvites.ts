import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";

/**
 * Single-use links that add a signed-in user to a family with a fixed role.
 * Only SHA-256(rawToken) is stored. Does not grant Closed Alpha registration.
 */
export const familyInvites = pgTable(
  "family_invites",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByUserId: uuid("consumed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex("family_invites_token_hash_uq").on(t.tokenHash),
    familyIdx: index("family_invites_family_id_idx").on(t.familyId),
    roleCk: check(
      "family_invites_role_ck",
      sql`${t.role} IN ('ADMIN', 'EDITOR', 'VIEWER')`
    ),
  })
);
