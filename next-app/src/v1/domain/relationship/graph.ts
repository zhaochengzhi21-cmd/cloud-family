/**
 * Ancestry cycle detection on parent→child directed edges.
 * All parent-like types share one DAG.
 */

import { RelationshipDomainError } from "./errors";

export type ParentEdge = {
  fromPersonId: string; // parent
  toPersonId: string; // child
};

/**
 * Would adding parent→child create a cycle?
 * True iff child can already reach parent along existing parent→child edges.
 */
export function wouldCreateAncestryCycle(
  edges: ParentEdge[],
  parentId: string,
  childId: string
): boolean {
  if (parentId === childId) return true;

  // adjacency: parent → children
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenOf.get(e.fromPersonId);
    if (list) list.push(e.toPersonId);
    else childrenOf.set(e.fromPersonId, [e.toPersonId]);
  }

  // BFS from child along parent→child; if we reach parent, cycle
  const queue: string[] = [childId];
  const seen = new Set<string>([childId]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === parentId) return true;
    const kids = childrenOf.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return false;
}

export function assertNoAncestryCycle(
  edges: ParentEdge[],
  parentId: string,
  childId: string
): void {
  if (wouldCreateAncestryCycle(edges, parentId, childId)) {
    throw new RelationshipDomainError("ANCESTRY_CYCLE");
  }
}
