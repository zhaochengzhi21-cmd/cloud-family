import {
  pgTable,
  uuid,
  text,
  integer,
  customType,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { alphaInvites } from "./alphaInvites";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Email OTP challenges — created before User exists.
 * Stores HMAC code digest only; no plaintext OTP or email.
 * alphaInviteId set only for Closed Alpha new-user registration.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").primaryKey(),
    emailLookupHash: text("email_lookup_hash").notNull(),
    emailCiphertext: bytea("email_ciphertext").notNull(),
    emailKeyVersion: integer("email_key_version").notNull(),
    codeDigest: text("code_digest").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    alphaInviteId: uuid("alpha_invite_id").references(() => alphaInvites.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    emailLookupIdx: index("auth_challenges_email_lookup_hash_idx").on(
      t.emailLookupHash
    ),
    expiresIdx: index("auth_challenges_expires_at_idx").on(t.expiresAt),
    failedAttemptsCk: check(
      "auth_challenges_failed_attempts_ck",
      sql`${t.failedAttempts} >= 0`
    ),
    keyVersionCk: check(
      "auth_challenges_email_key_version_ck",
      sql`${t.emailKeyVersion} > 0`
    ),
  })
);
