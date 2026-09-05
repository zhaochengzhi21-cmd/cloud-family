import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { families } from "./families";
import { users } from "./users";

/**
 * Append-only audit log.
 *
 * NEVER store in metadata_json:
 * JWT, password, OTP, email plaintext, secrets, database URL,
 * raw image bytes, or chat message bodies.
 * Callers must sanitize before insert.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id").references(() => families.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    familyIdx: index("audit_events_family_id_idx").on(t.familyId),
    createdAtIdx: index("audit_events_created_at_idx").on(t.createdAt),
  })
);
