/**
 * AI-era channel for family workspace — what agents may propose, and what
 * humans still owe. Product rule: agents propose; OWNER/ADMIN confirm; never
 * invent sources. Product language stays 人物资料 / 资料来源 (no model names).
 */

import { getV1Db, type V1Db } from "@/db/client";
import type { AccessContext } from "@/v1/domain/permission/types";
import {
  authorizeFamilyAction,
} from "@/v1/services/permissionService";
import { PermissionDomainError } from "@/v1/domain/permission/errors";
import { getFamilyGraph } from "@/v1/services/familyGraphService";
import { getClaimsForSubject } from "@/v1/services/claimService";
import { listClaimIdsWithActiveEvidence } from "@/v1/repositories/evidenceRepository";
import { mapPool } from "@/v1/util/pool";
import {
  getClaimTypeDefinition,
  listRegisteredClaimTypes,
} from "@/v1/domain/claim/registry";
import * as activityRepo from "@/v1/repositories/activityRepository";

const PRINCIPLES = [
  "Agents may propose person facts with originType AI_EXTRACTION or IMPORT; creates are always 待确认 (PROPOSED).",
  "Prefer POST …/claims/batch for multi-fact extraction; use Idempotency-Key on retries so duplicate posts replay safely.",
  "Send X-Client-Agent (e.g. cursor, chatgpt) so drafts are attributable in audit — session user remains the actor.",
  "Only OWNER/ADMIN may confirm or reject; editors may propose but cannot accept.",
  "After proposing, poll this channel for recentDecisions — never invent acceptances.",
  "Do not invent 资料来源. Create real evidence first, then POST …/evidence/{id}/links to attach many claims.",
  "Speak product language only: 人物资料 / 资料来源 / 不同说法 — never expose model or Claim jargon to end users.",
  "Use claimTypes below for allowed types and value shapes; prefer the tasks list over inventing work.",
] as const;

const DECISION_EVENT_TYPES = [
  "CLAIM_ACCEPTED",
  "CLAIM_REJECTED",
  "CLAIM_REOPENED",
] as const;

export type AgentCapability = {
  id: string;
  summary: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  roles: Array<"OWNER" | "ADMIN" | "EDITOR" | "VIEWER">;
  bodyHints?: Record<string, string>;
  policy: string[];
};

export type AgentTask = {
  id: string;
  kind:
    | "REVIEW_CLAIM"
    | "ATTACH_SOURCE"
    | "CONNECT_PERSON"
    | "PROPOSE_FACT";
  priority: number;
  personId?: string;
  personName?: string;
  claimId?: string;
  claimType?: string;
  originType?: string;
  text?: string | null;
  suggest: {
    method: "GET" | "POST";
    path: string;
    note: string;
  };
};

export type AgentClaimType = {
  type: string;
  cardinality: "SINGLETON" | "MULTI";
  kind: "TEXTUAL" | "RELATIONSHIP_ASSERTION";
  valueShape: string;
};

export type AgentDecision = {
  id: string;
  at: string;
  decision: "ACCEPTED" | "REJECTED" | "REOPENED";
  claimId: string;
  claimType?: string;
  personId?: string;
  personName?: string;
};

export type AgentChannel = {
  principles: readonly string[];
  /** Machine catalog — what agents may put in claimType / value. */
  claimTypes: AgentClaimType[];
  /** Human review outcomes since last poll — agents should wait on these. */
  recentDecisions: AgentDecision[];
  capabilities: AgentCapability[];
  tasks: AgentTask[];
  taskTotal: number;
};

function claimTypesCatalog(): AgentClaimType[] {
  return listRegisteredClaimTypes().map((type) => {
    const def = getClaimTypeDefinition(type)!;
    return {
      type,
      cardinality: def.cardinality,
      kind: def.kind,
      valueShape:
        def.kind === "TEXTUAL"
          ? '{ "text": string, "narrator"?: string }'
          : '{ "otherPersonId": uuid, "relationshipType": string, "direction": string }',
    };
  });
}

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function capabilitiesForRole(
  familyId: string,
  role: string | null
): AgentCapability[] {
  const base = `/api/v1/families/${familyId}`;
  const all: AgentCapability[] = [
    {
      id: "read_agent_channel",
      summary: "Poll principles, claimTypes, tasks, and recentDecisions",
      method: "GET",
      path: `${base}/agent`,
      roles: ["OWNER", "ADMIN", "EDITOR", "VIEWER"],
      policy: [
        "recentDecisions lists human ACCEPTED/REJECTED/REOPENED — do not invent",
      ],
    },
    {
      id: "read_overview",
      summary: "Read archive progress, pending review, and unsourced accepted facts",
      method: "GET",
      path: `${base}/overview`,
      roles: ["OWNER", "ADMIN", "EDITOR", "VIEWER"],
      policy: ["Privacy-filtered to the caller graph"],
    },
    {
      id: "read_graph",
      summary: "Read visible persons and relationships",
      method: "GET",
      path: `${base}/graph`,
      roles: ["OWNER", "ADMIN", "EDITOR", "VIEWER"],
      policy: ["Privacy-filtered"],
    },
    {
      id: "propose_claim",
      summary: "Propose a person fact for human confirmation",
      method: "POST",
      path: `${base}/claims`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      bodyHints: {
        subjectType: "PERSON",
        subjectId: "uuid",
        claimType: "BIRTH_DATE|OCCUPATION|STORY|…",
        value: '{ "text": "…" }',
        originType: "AI_EXTRACTION|IMPORT|MANUAL",
        confidence: "0..1 optional for AI_EXTRACTION",
        "Idempotency-Key": "optional header — safe AI retry",
        "X-Client-Agent": "optional — cursor|chatgpt|… for audit",
      },
      policy: [
        "Always creates PROPOSED — never auto-accepted",
        "Duplicate active fingerprint → error (use batch onDuplicate=reuse)",
      ],
    },
    {
      id: "propose_claims_batch",
      summary: "Propose up to 20 facts in one call (OCR / page extract)",
      method: "POST",
      path: `${base}/claims/batch`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      bodyHints: {
        claims: "array of propose_claim bodies (+ optional clientItemId)",
        onDuplicate: "reuse|error — default reuse",
        "Idempotency-Key": "optional header — safe AI retry",
        "X-Client-Agent": "optional — cursor|chatgpt|… for audit",
      },
      policy: [
        "Partial success — check results[].ok per item",
        "Never auto-accept; human review still required",
      ],
    },
    {
      id: "attach_evidence",
      summary: "Create a source and/or link it to a claim",
      method: "POST",
      path: `${base}/evidence`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      bodyHints: {
        evidenceType: "GENEALOGY_PAGE|ORAL_HISTORY|DOCUMENT|…",
        title: "optional",
      },
      policy: [
        "Link one claim: POST …/claims/{claimId}/evidence",
        "Link many claims: POST …/evidence/{evidenceId}/links",
      ],
    },
    {
      id: "link_evidence_batch",
      summary: "Attach one 资料来源 to up to 20 claims (OCR page)",
      method: "POST",
      path: `${base}/evidence/{evidenceId}/links`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      bodyHints: {
        claimIds: "uuid[]",
        relation: "SUPPORTS|CONTRADICTS|CONTEXT — default SUPPORTS",
        onDuplicate: "reuse|error — default reuse",
        "Idempotency-Key": "optional header — safe AI retry",
      },
      policy: [
        "Partial success — check results[].ok",
        "Does not invent sources — evidenceId must already exist",
      ],
    },
    {
      id: "accept_claim",
      summary: "Confirm a proposed fact (human review)",
      method: "POST",
      path: `${base}/claims/{claimId}/accept`,
      roles: ["OWNER", "ADMIN"],
      policy: ["REVIEW_CLAIM only — agents must not auto-call without user intent"],
    },
    {
      id: "reject_claim",
      summary: "Mark a proposed fact as not adopted",
      method: "POST",
      path: `${base}/claims/{claimId}/reject`,
      roles: ["OWNER", "ADMIN"],
      policy: ["Reopenable via …/reopen"],
    },
    {
      id: "create_person",
      summary: "Add a family member",
      method: "POST",
      path: `${base}/persons`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      policy: ["Then propose facts / relationships as needed"],
    },
    {
      id: "create_relationship",
      summary: "Record parent or spouse edge",
      method: "POST",
      path: `${base}/relationships`,
      roles: ["OWNER", "ADMIN", "EDITOR"],
      policy: ["Soft-deletable; restore via …/restore"],
    },
  ];
  if (!role) return [];
  return all.filter((c) =>
    c.roles.includes(role as AgentCapability["roles"][number])
  );
}

/**
 * Authenticated agent channel for one family: principles, role-gated
 * capabilities, and a prioritized task queue derived from the live graph.
 */
export async function getFamilyAgentChannel(
  familyId: string,
  actorContext: AccessContext,
  options?: { db?: V1Db; limit?: number }
): Promise<AgentChannel> {
  const database = dbOrDefault(options?.db);
  const limit = Math.min(Math.max(options?.limit ?? 40, 1), 80);

  let auth;
  try {
    auth = await authorizeFamilyAction(
      familyId,
      actorContext,
      "READ_FAMILY",
      { db: database }
    );
  } catch (e) {
    if (e instanceof PermissionDomainError) throw e;
    throw e;
  }
  if (auth.decision !== "ALLOW") {
    throw new PermissionDomainError("FORBIDDEN");
  }

  const role = auth.activeRole;
  const caps = capabilitiesForRole(familyId, role);

  const graph = await getFamilyGraph(familyId, actorContext, { db: database });
  const names = new Map(graph.persons.map((p) => [p.id, p.preferredName]));
  const linked = new Set<string>();
  for (const r of graph.relationships) {
    linked.add(r.fromPersonId);
    linked.add(r.toPersonId);
  }

  const tasks: AgentTask[] = [];
  const acceptedIds: string[] = [];
  const acceptedMeta: Array<{
    claimId: string;
    personId: string;
    claimType: string;
  }> = [];

  const rows = await mapPool(graph.persons, 8, async (person) => {
    const claims = await getClaimsForSubject(
      familyId,
      "PERSON",
      person.id,
      actorContext,
      { db: database }
    );
    return { person, claims };
  });

  for (const { person, claims } of rows) {
    const types = new Set(
      claims.filter((c) => c.status !== "REJECTED").map((c) => c.claimType)
    );
    for (const c of claims) {
      if (c.status === "PROPOSED" || c.status === "CONFLICTED") {
        const value = c.value as { text?: unknown } | null;
        const ai = c.originType === "AI_EXTRACTION" || c.originType === "IMPORT";
        tasks.push({
          id: `review:${c.id}`,
          kind: "REVIEW_CLAIM",
          priority: ai ? 10 : c.status === "CONFLICTED" ? 20 : 30,
          personId: person.id,
          personName: person.preferredName,
          claimId: c.id,
          claimType: c.claimType,
          originType: c.originType,
          text: typeof value?.text === "string" ? value.text : null,
          suggest: {
            method: "POST",
            path: `/api/v1/families/${familyId}/claims/${c.id}/accept`,
            note: "Human OWNER/ADMIN confirms; or /reject",
          },
        });
      } else if (c.status === "ACCEPTED") {
        acceptedIds.push(c.id);
        acceptedMeta.push({
          claimId: c.id,
          personId: person.id,
          claimType: c.claimType,
        });
      }
    }

    if (!linked.has(person.id) && graph.persons.length >= 2) {
      tasks.push({
        id: `connect:${person.id}`,
        kind: "CONNECT_PERSON",
        priority: 40,
        personId: person.id,
        personName: person.preferredName,
        suggest: {
          method: "POST",
          path: `/api/v1/families/${familyId}/relationships`,
          note: "Propose parent/spouse edge after human intent",
        },
      });
    }

    if (!types.has("BIRTH_DATE")) {
      tasks.push({
        id: `propose-birth:${person.id}`,
        kind: "PROPOSE_FACT",
        priority: 50,
        personId: person.id,
        personName: person.preferredName,
        claimType: "BIRTH_DATE",
        suggest: {
          method: "POST",
          path: `/api/v1/families/${familyId}/claims`,
          note: "Use originType AI_EXTRACTION when drafting from a scan/transcript",
        },
      });
    }
  }

  const sourced = await listClaimIdsWithActiveEvidence(database, acceptedIds);
  for (const m of acceptedMeta) {
    if (sourced.has(m.claimId)) continue;
    tasks.push({
      id: `source:${m.claimId}`,
      kind: "ATTACH_SOURCE",
      priority: 35,
      personId: m.personId,
      personName: names.get(m.personId),
      claimId: m.claimId,
      claimType: m.claimType,
      suggest: {
        method: "POST",
        path: `/api/v1/families/${familyId}/evidence`,
        note: "Then POST …/evidence/{evidenceId}/links with claimIds[] (or single claim link)",
      },
    });
  }

  tasks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const visiblePersons = new Set(graph.persons.map((p) => p.id));
  const decisionLimit = Math.min(20, limit);
  const decisionRows = await activityRepo.listRecentFamilyEvents(
    database,
    familyId,
    [...DECISION_EVENT_TYPES],
    decisionLimit * 3
  );
  const decisionClaimIds = decisionRows
    .map((r) => r.entityId)
    .filter((id): id is string => typeof id === "string");
  const claimSubjects = await activityRepo.findClaimSubjects(
    database,
    familyId,
    decisionClaimIds
  );
  const subjectById = new Map(claimSubjects.map((c) => [c.id, c]));
  const recentDecisions: AgentDecision[] = [];
  for (const r of decisionRows) {
    if (!r.entityId) continue;
    const c = subjectById.get(r.entityId);
    if (!c || c.subjectType !== "PERSON") continue;
    if (!visiblePersons.has(c.subjectId)) continue;
    const decision =
      r.eventType === "CLAIM_ACCEPTED"
        ? ("ACCEPTED" as const)
        : r.eventType === "CLAIM_REJECTED"
          ? ("REJECTED" as const)
          : ("REOPENED" as const);
    recentDecisions.push({
      id: r.id,
      at: r.createdAt.toISOString(),
      decision,
      claimId: c.id,
      claimType: c.claimType,
      personId: c.subjectId,
      personName: names.get(c.subjectId),
    });
    if (recentDecisions.length >= decisionLimit) break;
  }

  return {
    principles: PRINCIPLES,
    claimTypes: claimTypesCatalog(),
    recentDecisions,
    capabilities: caps,
    taskTotal: tasks.length,
    tasks: tasks.slice(0, limit),
  };
}
