/**
 * Canonical generation engine — derived only; never persisted.
 * Uses accepted active parent edges only. SPOUSE ignored for depth.
 */

import { RelationshipDomainError } from "./errors";
import type { ParentEdge } from "./graph";

export type GenerationResult = {
  personGenerations: Map<string, number>;
  totalGenerations: number;
  rootPersonIds: string[];
  componentCount: number;
  generationTensionEdges: Array<{
    fromPersonId: string;
    toPersonId: string;
    parentGeneration: number;
    childGeneration: number;
  }>;
};

/**
 * 1-based generations: roots = 1; child = max(parent gens) + 1.
 * Pedigree collapse uses longest ancestry path.
 */
export function computeGenerations(
  personIds: string[],
  parentEdges: ParentEdge[]
): GenerationResult {
  if (personIds.length === 0) {
    return {
      personGenerations: new Map(),
      totalGenerations: 0,
      rootPersonIds: [],
      componentCount: 0,
      generationTensionEdges: [],
    };
  }

  const idSet = new Set(personIds);
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of personIds) indegree.set(id, 0);

  for (const e of parentEdges) {
    if (!idSet.has(e.fromPersonId) || !idSet.has(e.toPersonId)) continue;
    const kids = childrenOf.get(e.fromPersonId);
    if (kids) kids.push(e.toPersonId);
    else childrenOf.set(e.fromPersonId, [e.toPersonId]);
    const pars = parentsOf.get(e.toPersonId);
    if (pars) pars.push(e.fromPersonId);
    else parentsOf.set(e.toPersonId, [e.fromPersonId]);
    indegree.set(e.toPersonId, (indegree.get(e.toPersonId) ?? 0) + 1);
  }

  // Kahn topological sort — detect cycles
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  const order: string[] = [];
  const workingIndegree = new Map(indegree);
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const kid of childrenOf.get(cur) ?? []) {
      const next = (workingIndegree.get(kid) ?? 0) - 1;
      workingIndegree.set(kid, next);
      if (next === 0) queue.push(kid);
    }
  }
  if (order.length !== personIds.length) {
    throw new RelationshipDomainError("GRAPH_CYCLE_DETECTED");
  }

  const personGenerations = new Map<string, number>();
  for (const id of order) {
    const parents = parentsOf.get(id);
    if (!parents || parents.length === 0) {
      personGenerations.set(id, 1);
    } else {
      let maxP = 0;
      for (const p of parents) {
        maxP = Math.max(maxP, personGenerations.get(p) ?? 1);
      }
      personGenerations.set(id, maxP + 1);
    }
  }

  const rootPersonIds = personIds.filter(
    (id) => !parentsOf.has(id) || (parentsOf.get(id)?.length ?? 0) === 0
  );

  let totalGenerations = 0;
  for (const g of personGenerations.values()) {
    if (g > totalGenerations) totalGenerations = g;
  }

  // Connected components (undirected over parent edges)
  const undirected = new Map<string, string[]>();
  for (const id of personIds) undirected.set(id, []);
  for (const e of parentEdges) {
    if (!idSet.has(e.fromPersonId) || !idSet.has(e.toPersonId)) continue;
    undirected.get(e.fromPersonId)!.push(e.toPersonId);
    undirected.get(e.toPersonId)!.push(e.fromPersonId);
  }
  const seen = new Set<string>();
  let componentCount = 0;
  for (const id of personIds) {
    if (seen.has(id)) continue;
    componentCount++;
    const q = [id];
    seen.add(id);
    while (q.length) {
      const c = q.pop()!;
      for (const n of undirected.get(c) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
  }

  const generationTensionEdges: GenerationResult["generationTensionEdges"] =
    [];
  for (const e of parentEdges) {
    if (!idSet.has(e.fromPersonId) || !idSet.has(e.toPersonId)) continue;
    const pg = personGenerations.get(e.fromPersonId)!;
    const cg = personGenerations.get(e.toPersonId)!;
    if (cg !== pg + 1) {
      generationTensionEdges.push({
        fromPersonId: e.fromPersonId,
        toPersonId: e.toPersonId,
        parentGeneration: pg,
        childGeneration: cg,
      });
    }
  }

  return {
    personGenerations,
    totalGenerations,
    rootPersonIds,
    componentCount,
    generationTensionEdges,
  };
}
