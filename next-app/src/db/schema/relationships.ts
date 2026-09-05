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
import { persons } from "./persons";
import { users } from "./users";

/**
 * Structured relationships — sole source of truth for kinship edges.
 * Parent types: from = parent, to = child.
 */
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "restrict" }),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    relationshipType: text("relationship_type").notNull(),
    status: text("status").notNull().default("ACCEPTED"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    familyIdx: index("relationships_family_id_idx").on(t.familyId),
    fromIdx: index("relationships_from_person_id_idx").on(t.fromPersonId),
    toIdx: index("relationships_to_person_id_idx").on(t.toPersonId),
    activeEdgeUq: uniqueIndex("relationships_active_edge_uq")
      .on(t.familyId, t.fromPersonId, t.toPersonId, t.relationshipType)
      .where(sql`${t.deletedAt} IS NULL`),
    typeCk: check(
      "relationships_type_ck",
      sql`${t.relationshipType} IN ('BIOLOGICAL_PARENT', 'ADOPTIVE_PARENT', 'STEP_PARENT', 'SPOUSE')`
    ),
    statusCk: check(
      "relationships_status_ck",
      sql`${t.status} IN ('PROPOSED', 'ACCEPTED', 'DISPUTED', 'REJECTED')`
    ),
    noSelfCk: check(
      "relationships_no_self_ck",
      sql`${t.fromPersonId} <> ${t.toPersonId}`
    ),
  })
);
