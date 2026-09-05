import {
  pgTable,
  uuid,
  text,
  integer,
  customType,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** bytea — AES-256-GCM email ciphertext envelope. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Product account (not a genealogy Person).
 * No plaintext email. No password (passwordless).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    emailLookupHash: text("email_lookup_hash"),
    emailCiphertext: bytea("email_ciphertext"),
    emailKeyVersion: integer("email_key_version"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    emailLookupHashUq: uniqueIndex("users_email_lookup_hash_uq").on(
      t.emailLookupHash
    ),
  })
);
