import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Closed Alpha registration invites — email-bound, single-use.
 * Stores SHA-256(rawToken) only; never raw token or plaintext email.
 */
export const alphaInvites = pgTable(
  "alpha_invites",
  {
    id: uuid("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    emailLookupHash: text("email_lookup_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex("alpha_invites_token_hash_uq").on(t.tokenHash),
    emailLookupIdx: index("alpha_invites_email_lookup_hash_idx").on(
      t.emailLookupHash
    ),
    expiresIdx: index("alpha_invites_expires_at_idx").on(t.expiresAt),
  })
);
