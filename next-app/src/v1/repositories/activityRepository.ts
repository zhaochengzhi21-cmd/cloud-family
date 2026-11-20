/**
 * Trusted internal reads for the family activity feed — callers must authorize
 * family read and apply person-level privacy before exposing anything.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { V1Db } from "@/db/client";
import {
  auditEvents,
  claims,
  evidence,
  familyMemberships,
  relationships,
} from "@/db/schema";

export type DbOrTx = V1Db | Parameters<Parameters<V1Db["transaction"]>[0]>[0];

export async function listRecentFamilyEvents(
  db: DbOrTx,
  familyId: string,
  eventTypes: string[],
  limit: number
) {
  return db
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorRole: familyMemberships.role,
      eventType: auditEvents.eventType,
      entityId: auditEvents.entityId,
      metadataJson: auditEvents.metadataJson,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(
      familyMemberships,
      and(
        eq(familyMemberships.familyId, auditEvents.familyId),
        eq(familyMemberships.userId, auditEvents.actorUserId)
      )
    )
    .where(
      and(
        eq(auditEvents.familyId, familyId),
        inArray(auditEvents.eventType, eventTypes)
      )
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

/** Includes rejected claims — the feed describes history. */
export async function findClaimSubjects(
  db: DbOrTx,
  familyId: string,
  claimIds: string[]
) {
  if (claimIds.length === 0) return [];
  return db
    .select({
      id: claims.id,
      subjectType: claims.subjectType,
      subjectId: claims.subjectId,
      claimType: claims.claimType,
    })
    .from(claims)
    .where(and(eq(claims.familyId, familyId), inArray(claims.id, claimIds)));
}

/** Includes soft-deleted edges so removals can still be described. */
export async function findRelationshipEndpoints(
  db: DbOrTx,
  familyId: string,
  relationshipIds: string[]
) {
  if (relationshipIds.length === 0) return [];
  return db
    .select({
      id: relationships.id,
      fromPersonId: relationships.fromPersonId,
      toPersonId: relationships.toPersonId,
      relationshipType: relationships.relationshipType,
      deletedAt: relationships.deletedAt,
    })
    .from(relationships)
    .where(
      and(
        eq(relationships.familyId, familyId),
        inArray(relationships.id, relationshipIds)
      )
    );
}

/** Includes soft-deleted sources so removals can still be described / restored. */
export async function findEvidenceSummaries(
  db: DbOrTx,
  familyId: string,
  evidenceIds: string[]
) {
  if (evidenceIds.length === 0) return [];
  return db
    .select({
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      deletedAt: evidence.deletedAt,
    })
    .from(evidence)
    .where(
      and(
        eq(evidence.familyId, familyId),
        inArray(evidence.id, evidenceIds)
      )
    );
}
