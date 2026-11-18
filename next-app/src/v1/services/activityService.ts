/**
 * Family activity feed — "who added what, recently".
 *
 * Privacy: the caller's privacy-filtered family graph is the visibility
 * boundary. Events about persons outside it are dropped, never anonymized,
 * so the feed cannot reveal that a hidden person exists. Free-text values
 * (names of deleted persons, claim text, evidence titles) are never exposed.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import { getFamilyGraph } from "@/v1/services/familyGraphService";
import * as activityRepo from "@/v1/repositories/activityRepository";

const FEED_EVENT_TYPES = [
  "FAMILY_CREATED",
  "FAMILY_IDENTITY_UPDATED",
  "PERSON_CREATED",
  "PERSON_UPDATED",
  "PERSON_DELETED",
  "RELATIONSHIP_CREATED",
  "RELATIONSHIP_DELETED",
  "CLAIM_CREATED",
  "CLAIM_ACCEPTED",
  "CLAIM_REJECTED",
  "EVIDENCE_CREATED",
  "EVIDENCE_DELETED",
  "MEMBER_JOINED",
];

/** Claim types surfaced in the product UI; others (e.g. assertions) stay out of the feed. */
const FEED_CLAIM_TYPES = new Set([
  "BIRTH_DATE",
  "DEATH_DATE",
  "BIRTH_PLACE",
  "ANCESTRAL_PLACE",
  "BURIAL_PLACE",
  "GENERATION_WORD",
  "BIRTH_ORDER",
  "ALIAS",
  "OCCUPATION",
  "STORY",
]);

export type ActivityItem = {
  id: string;
  at: string;
  eventType: string;
  actor: { isYou: boolean; role: string | null };
  personId?: string;
  personName?: string;
  otherPersonId?: string;
  otherPersonName?: string;
  claimType?: string;
  relationshipType?: string;
  evidenceType?: string;
};

function actorUserId(ctx: AccessContext): string | null {
  if (ctx.kind === "USER" || ctx.kind === "USER_AND_SHARE_LINK") {
    return ctx.userId;
  }
  return null;
}

function metaString(meta: unknown, key: string): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

export async function getFamilyActivity(
  familyId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db; limit?: number }
): Promise<ActivityItem[]> {
  const database = options?.db ?? getV1Db();
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);

  const graph = await getFamilyGraph(familyId, actorContext, { db: database });
  const names = new Map(graph.persons.map((p) => [p.id, p.preferredName]));
  const me = actorUserId(actorContext);

  // Over-fetch: privacy filtering drops some rows.
  const rows = await activityRepo.listRecentFamilyEvents(
    database,
    familyId,
    FEED_EVENT_TYPES,
    limit * 4
  );

  const claimIds = rows
    .filter((r) => r.eventType.startsWith("CLAIM_") && r.entityId)
    .map((r) => r.entityId as string);
  const relIds = rows
    .filter((r) => r.eventType.startsWith("RELATIONSHIP_") && r.entityId)
    .map((r) => r.entityId as string);

  const [claimRows, relRows] = await Promise.all([
    activityRepo.findClaimSubjects(database, familyId, claimIds),
    activityRepo.findRelationshipEndpoints(database, familyId, relIds),
  ]);
  const claimById = new Map(claimRows.map((c) => [c.id, c]));
  const relById = new Map(relRows.map((r) => [r.id, r]));

  const items: ActivityItem[] = [];
  for (const r of rows) {
    if (items.length >= limit) break;
    const base: ActivityItem = {
      id: r.id,
      at: r.createdAt.toISOString(),
      eventType: r.eventType,
      actor: {
        isYou: Boolean(me && r.actorUserId === me),
        role: r.actorRole ?? null,
      },
    };

    switch (r.eventType) {
      case "FAMILY_CREATED":
      case "FAMILY_IDENTITY_UPDATED":
      case "PERSON_DELETED":
      case "EVIDENCE_DELETED":
      case "MEMBER_JOINED":
        items.push(base);
        break;
      case "EVIDENCE_CREATED":
        items.push({
          ...base,
          evidenceType: metaString(r.metadataJson, "evidenceType"),
        });
        break;
      case "PERSON_CREATED":
      case "PERSON_UPDATED": {
        const name = r.entityId ? names.get(r.entityId) : undefined;
        if (!name) break;
        items.push({ ...base, personId: r.entityId!, personName: name });
        break;
      }
      case "RELATIONSHIP_CREATED":
      case "RELATIONSHIP_DELETED": {
        const rel = r.entityId ? relById.get(r.entityId) : undefined;
        if (!rel) break;
        const a = names.get(rel.fromPersonId);
        const b = names.get(rel.toPersonId);
        if (!a || !b) break;
        items.push({
          ...base,
          personId: rel.fromPersonId,
          personName: a,
          otherPersonId: rel.toPersonId,
          otherPersonName: b,
          relationshipType: rel.relationshipType,
        });
        break;
      }
      case "CLAIM_CREATED":
      case "CLAIM_ACCEPTED":
      case "CLAIM_REJECTED": {
        const c = r.entityId ? claimById.get(r.entityId) : undefined;
        if (!c || c.subjectType !== "PERSON") break;
        if (!FEED_CLAIM_TYPES.has(c.claimType)) break;
        const name = names.get(c.subjectId);
        if (!name) break;
        items.push({
          ...base,
          personId: c.subjectId,
          personName: name,
          claimType: c.claimType,
        });
        break;
      }
    }
  }
  return items;
}
