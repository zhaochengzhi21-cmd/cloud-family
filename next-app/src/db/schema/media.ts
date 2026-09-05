import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { families } from "./families";
import { users } from "./users";

/**
 * Media metadata. storage_key is NOT a public URL.
 * storage_provider stays adapter-agnostic (LEGACY_IPFS | PRIVATE_OBJECT).
 */
export const mediaObjects = pgTable(
  "media_objects",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    visibility: text("visibility").notNull().default("PRIVATE"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    familyIdx: index("media_objects_family_id_idx").on(t.familyId),
    sha256Idx: index("media_objects_sha256_idx").on(t.sha256),
    storageUq: uniqueIndex("media_objects_storage_uq").on(
      t.storageProvider,
      t.storageKey
    ),
    providerCk: check(
      "media_objects_provider_ck",
      sql`${t.storageProvider} IN ('LEGACY_IPFS', 'PRIVATE_OBJECT')`
    ),
    visibilityCk: check(
      "media_objects_visibility_ck",
      sql`${t.visibility} IN ('PRIVATE', 'FAMILY', 'PUBLIC')`
    ),
    statusCk: check(
      "media_objects_status_ck",
      sql`${t.status} IN ('ACTIVE', 'DELETED')`
    ),
  })
);
