/**
 * Birth / sibling order (排行) — accepted BIRTH_ORDER claims, keyed by person.
 * Same privacy boundary as generation words.
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import { getFamilyGraph } from "@/v1/services/familyGraphService";
import { canReadClaim } from "@/v1/services/claimService";
import * as claimRepo from "@/v1/repositories/claimRepository";

export async function getBirthOrders(
  familyId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db }
): Promise<Record<string, string>> {
  const db = options?.db ?? getV1Db();
  const graph = await getFamilyGraph(familyId, actorContext, { db });
  const visible = new Set(graph.persons.map((p) => p.id));

  const rows = await claimRepo.listActiveClaimsByType(db, {
    familyId,
    subjectType: "PERSON",
    claimType: "BIRTH_ORDER",
    status: "ACCEPTED",
  });

  const byPerson: Record<string, string> = {};
  for (const row of rows) {
    if (!visible.has(row.subjectId) || byPerson[row.subjectId]) continue;
    const text = (row.valueJson as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || !text.trim()) continue;
    if (!(await canReadClaim(row, actorContext, { db }))) continue;
    byPerson[row.subjectId] = text.trim();
  }
  return byPerson;
}
