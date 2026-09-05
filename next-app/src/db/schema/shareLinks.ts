import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { families } from "./families";
import { users } from "./users";

/**
 * LINK-visibility share tokens.
 * Only SHA-256(rawToken) is stored — raw token never persists.
 * First version: READ access only.
 */
export const familyShareLinks = pgTable(
  "family_share_links",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex("family_share_links_token_hash_uq").on(t.tokenHash),
    familyIdx: index("family_share_links_family_id_idx").on(t.familyId),
    expiresIdx: index("family_share_links_expires_at_idx").on(t.expiresAt),
  })
);
