import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Opaque DB-backed sessions (not JWT).
 * Only SHA-256(token) is stored — raw token never persists.
 * Immediate revocation via revoked_at.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => ({
    tokenHashUq: uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    userIdx: index("sessions_user_id_idx").on(t.userId),
    expiresIdx: index("sessions_expires_at_idx").on(t.expiresAt),
  })
);
