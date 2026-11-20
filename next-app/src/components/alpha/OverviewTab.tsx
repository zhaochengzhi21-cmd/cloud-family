"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CLAIM_ORIGIN_LABEL,
  CLAIM_STATUS_LABEL,
  CLAIM_TYPE_UI,
  EVIDENCE_TYPE_UI,
  ROLE_LABEL,
  relativeTimeLabel,
} from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";
import { FamilyInvites } from "@/components/alpha/FamilyInvites";
import { FamilySources } from "@/components/alpha/FamilySources";
import { gedcomFromExport } from "@/v1/export/gedcom";

type Person = {
  id: string;
  preferredName: string;
  livingStatus?: string;
  gender?: string;
};
type Rel = { fromPersonId: string; toPersonId: string; type?: string };

const PARENT_REL_TYPES = new Set([
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
]);

type Overview = Awaited<ReturnType<typeof v1api.getOverview>>["overview"];
type ActivityItem = Awaited<
  ReturnType<typeof v1api.getActivity>
>["activity"][number];

/** Sentence pieces: plain text or a person reference rendered as a link. */
type Piece = string | { personId: string; name: string };

const PARENT_KIND: Record<string, string> = {
  BIOLOGICAL_PARENT: "父母",
  ADOPTIVE_PARENT: "养父母",
  STEP_PARENT: "继父母",
};

function actorLabel(a: ActivityItem["actor"]): string {
  if (a.isYou) return "你";
  if (a.role && a.role in ROLE_LABEL) {
    return ROLE_LABEL[a.role as keyof typeof ROLE_LABEL];
  }
  return "家人";
}

function activityPieces(item: ActivityItem): Piece[] | null {
  const p: Piece | null =
    item.personId && item.personName
      ? { personId: item.personId, name: item.personName }
      : null;
  const o: Piece | null =
    item.otherPersonId && item.otherPersonName
      ? { personId: item.otherPersonId, name: item.otherPersonName }
      : null;
  const claimLabel = item.claimType
    ? CLAIM_TYPE_UI[item.claimType]?.label ?? "资料"
    : "资料";
  switch (item.eventType) {
    case "FAMILY_CREATED":
      return ["创建了家族档案"];
    case "FAMILY_IDENTITY_UPDATED":
      return ["更新了家族档案信息"];
    case "PERSON_CREATED":
      return p ? ["添加了成员「", p, "」"] : null;
    case "PERSON_UPDATED":
      return p ? ["更新了「", p, "」的基本信息"] : null;
    case "PERSON_DELETED":
      // Name is plain text — profile route 404s while soft-deleted.
      return item.personName
        ? [`移除了成员「${item.personName}」`]
        : ["移除了一位成员"];
    case "PERSON_RESTORED":
      return p ? ["恢复了成员「", p, "」"] : null;
    case "RELATIONSHIP_CREATED":
      if (!p || !o) return null;
      return item.relationshipType === "SPOUSE"
        ? ["记录了「", p, "」与「", o, "」为配偶"]
        : [
            "记录了「",
            p,
            `」是「`,
            o,
            `」的${PARENT_KIND[item.relationshipType ?? ""] ?? "父母"}`,
          ];
    case "RELATIONSHIP_DELETED":
      return p && o ? ["取消了「", p, "」与「", o, "」的家庭关系"] : null;
    case "RELATIONSHIP_RESTORED":
      return p && o ? ["恢复了「", p, "」与「", o, "」的家庭关系"] : null;
    case "CLAIM_CREATED":
      if (
        item.originType === "AI_EXTRACTION" ||
        item.originType === "IMPORT"
      ) {
        return p
          ? ["整理了「", p, `」的一条${claimLabel}（待确认）`]
          : null;
      }
      return p ? ["为「", p, `」添加了${claimLabel}`] : null;
    case "CLAIM_ACCEPTED":
      return p ? ["确认了「", p, `」的${claimLabel}`] : null;
    case "CLAIM_REJECTED":
      return p ? ["不采用「", p, `」的一条${claimLabel}`] : null;
    case "CLAIM_REOPENED":
      return p ? ["重新打开了「", p, `」的一条${claimLabel}`] : null;
    case "EVIDENCE_CREATED": {
      const t = item.evidenceType ? EVIDENCE_TYPE_UI[item.evidenceType] : null;
      return [t ? `添加了一条资料来源（${t}）` : "添加了一条资料来源"];
    }
    case "EVIDENCE_DELETED": {
      const t = item.evidenceType ? EVIDENCE_TYPE_UI[item.evidenceType] : null;
      return [t ? `移除了一条资料来源（${t}）` : "移除了一条资料来源"];
    }
    case "EVIDENCE_RESTORED": {
      const t = item.evidenceType ? EVIDENCE_TYPE_UI[item.evidenceType] : null;
      return [t ? `恢复了一条资料来源（${t}）` : "恢复了一条资料来源"];
    }
    case "MEMBER_JOINED":
      return ["通过邀请加入了家族"];
    case "MEMBERSHIP_ROLE_CHANGED": {
      const roleKey = item.membershipRole;
      const roleLabel =
        roleKey && roleKey in ROLE_LABEL
          ? ROLE_LABEL[roleKey as keyof typeof ROLE_LABEL]
          : "新权限";
      return [`将一个账号改为${roleLabel}`];
    }
    case "MEMBERSHIP_SUSPENDED":
      return ["移除了一个参与账号"];
    case "MEMBERSHIP_LEFT":
      return ["退出了家族"];
    default:
      return null;
  }
}

export function OverviewTab({
  familyId,
  persons,
  relationships,
  componentCount,
  generationByPerson,
  dataVersion,
  canEdit,
  canReview,
  onAddPerson,
  onAddRel,
  onAddKin,
  onOpenPerson,
  onOpenRecords,
  onOpenLineage,
  onRestorePerson,
  onRestoreRelationship,
  onRestoreEvidence,
  onReopenClaim,
  onReload,
  onEvidenceRemoved,
  onAuthError,
  externalFocusEvidenceId = null,
  onExternalFocusEvidenceConsumed,
}: {
  familyId: string;
  persons: Person[];
  relationships: Rel[];
  componentCount: number;
  generationByPerson?: Record<string, number>;
  /** Bumps whenever the workspace reloads so the summary stays in sync. */
  dataVersion: number;
  canEdit: boolean;
  canReview: boolean;
  onAddPerson: () => void;
  onAddRel: () => void;
  onAddKin?: (personId: string, role: "parent" | "spouse" | "child") => void;
  /** Open person drawer (e.g. to edit gender / living status). */
  onOpenPerson?: (
    personId: string,
    basicsFocus?: "living" | "gender" | "name"
  ) => void;
  onOpenRecords: (
    personId: string,
    opts?:
      | string
      | {
          claimType?: string;
          focusClaimId?: string;
          statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
          openEvidence?: boolean;
          evidenceType?: string;
        }
  ) => void;
  /** Jump to 世系 and highlight a person (relationship feed). */
  onOpenLineage?: (personId: string) => void;
  /** Undo soft-delete (OWNER/ADMIN). */
  onRestorePerson?: (personId: string) => void | Promise<void>;
  /** Undo soft-deleted relationship (EDITOR+). */
  onRestoreRelationship?: (relationshipId: string) => void | Promise<void>;
  /** Undo soft-deleted evidence (OWNER/ADMIN). */
  onRestoreEvidence?: (evidenceId: string) => void | Promise<void>;
  /** Undo mistaken reject (OWNER/ADMIN). */
  onReopenClaim?: (
    personId: string,
    claimId: string
  ) => void | Promise<void>;
  /** After batch review — refresh graph/claims elsewhere in the workspace. */
  onReload?: () => void | Promise<void>;
  /** Immediate undo flash after removing a source from the library. */
  onEvidenceRemoved?: (evidenceId: string, label: string) => void;
  onAuthError: (e: unknown) => boolean;
  externalFocusEvidenceId?: string | null;
  onExternalFocusEvidenceConsumed?: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchFlash, setBatchFlash] = useState("");
  const [batchUndo, setBatchUndo] = useState<null | {
    kind: "accept" | "reject";
    claimIds: string[];
  }>(null);
  const [focusEvidenceId, setFocusEvidenceId] = useState<string | null>(null);

  useEffect(() => {
    if (!externalFocusEvidenceId) return;
    setFocusEvidenceId(externalFocusEvidenceId);
    onExternalFocusEvidenceConsumed?.();
  }, [externalFocusEvidenceId, onExternalFocusEvidenceConsumed]);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [ov, act] = await Promise.all([
        v1api.getOverview(familyId),
        v1api.getActivity(familyId, 40),
      ]);
      setOverview(ov.overview);
      setActivity(act.activity);
    } catch (e) {
      if (onAuthError(e)) return;
      setLoadError(userMessageForApiError(e));
    }
  }, [familyId, onAuthError]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const personName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of persons) m.set(p.id, p.preferredName);
    return m;
  }, [persons]);

  const sortedPersons = useMemo(
    () =>
      persons
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons]
  );

  const unconnected = useMemo(() => {
    const linked = new Set<string>();
    for (const r of relationships) {
      linked.add(r.fromPersonId);
      linked.add(r.toPersonId);
    }
    return sortedPersons.filter((p) => !linked.has(p.id));
  }, [relationships, sortedPersons]);

  /** One person from each smaller connected component (for branch-merge chips). */
  const branchReps = useMemo(() => {
    if (componentCount <= 1) return [];
    const adj = new Map<string, string[]>();
    for (const p of sortedPersons) adj.set(p.id, []);
    for (const r of relationships) {
      adj.get(r.fromPersonId)?.push(r.toPersonId);
      adj.get(r.toPersonId)?.push(r.fromPersonId);
    }
    const seen = new Set<string>();
    const comps: Person[][] = [];
    for (const p of sortedPersons) {
      if (seen.has(p.id)) continue;
      const queue = [p];
      seen.add(p.id);
      const comp: Person[] = [];
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        for (const nid of adj.get(cur.id) ?? []) {
          if (seen.has(nid)) continue;
          seen.add(nid);
          const np = sortedPersons.find((x) => x.id === nid);
          if (np) queue.push(np);
        }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) return [];
    comps.sort(
      (a, b) =>
        b.length - a.length ||
        a[0].preferredName.localeCompare(b[0].preferredName, "zh-CN")
    );
    return comps
      .slice(1)
      .map(
        (c) =>
          c
            .slice()
            .sort((a, b) =>
              a.preferredName.localeCompare(b.preferredName, "zh-CN")
            )[0]
      )
      .slice(0, 6);
  }, [componentCount, relationships, sortedPersons]);

  /** Parents of someone who have no SPOUSE edge yet. */
  const missingSpouse = useMemo(() => {
    const parents = new Set<string>();
    const withSpouse = new Set<string>();
    for (const r of relationships) {
      if (r.type === "SPOUSE") {
        withSpouse.add(r.fromPersonId);
        withSpouse.add(r.toPersonId);
      } else if (!r.type || PARENT_REL_TYPES.has(r.type)) {
        parents.add(r.fromPersonId);
      }
    }
    return sortedPersons.filter(
      (p) => parents.has(p.id) && !withSpouse.has(p.id)
    );
  }, [relationships, sortedPersons]);

  /** People with a spouse who have no children yet. */
  const missingChildren = useMemo(() => {
    const withSpouse = new Set<string>();
    const withChildren = new Set<string>();
    for (const r of relationships) {
      if (r.type === "SPOUSE") {
        withSpouse.add(r.fromPersonId);
        withSpouse.add(r.toPersonId);
      } else if (!r.type || PARENT_REL_TYPES.has(r.type)) {
        withChildren.add(r.fromPersonId);
      }
    }
    return sortedPersons.filter(
      (p) => withSpouse.has(p.id) && !withChildren.has(p.id)
    );
  }, [relationships, sortedPersons]);

  /** People with spouse or children who have no parents yet. */
  const missingParents = useMemo(() => {
    const withSpouse = new Set<string>();
    const withChildren = new Set<string>();
    const withParents = new Set<string>();
    for (const r of relationships) {
      if (r.type === "SPOUSE") {
        withSpouse.add(r.fromPersonId);
        withSpouse.add(r.toPersonId);
      } else if (!r.type || PARENT_REL_TYPES.has(r.type)) {
        withChildren.add(r.fromPersonId);
        withParents.add(r.toPersonId);
      }
    }
    return sortedPersons.filter(
      (p) =>
        (withSpouse.has(p.id) || withChildren.has(p.id)) &&
        !withParents.has(p.id)
    );
  }, [relationships, sortedPersons]);

  const missingBirth = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) => !overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE")
    );
  }, [overview, sortedPersons]);

  const missingBirthPlace = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE") &&
        !overview.personStats[p.id]?.claimTypes.includes("BIRTH_PLACE")
    );
  }, [overview, sortedPersons]);

  const missingDeath = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        p.livingStatus === "DECEASED" &&
        !overview.personStats[p.id]?.claimTypes.includes("DEATH_DATE")
    );
  }, [overview, sortedPersons]);

  const missingBurial = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        p.livingStatus === "DECEASED" &&
        overview.personStats[p.id]?.claimTypes.includes("DEATH_DATE") &&
        !overview.personStats[p.id]?.claimTypes.includes("BURIAL_PLACE")
    );
  }, [overview, sortedPersons]);

  const missingAncestral = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) => !overview.personStats[p.id]?.claimTypes.includes("ANCESTRAL_PLACE")
    );
  }, [overview, sortedPersons]);

  /** Birth known but no occupation yet — gate like birth place. */
  const missingOccupation = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE") &&
        !overview.personStats[p.id]?.claimTypes.includes("OCCUPATION")
    );
  }, [overview, sortedPersons]);

  /** Birth known but no 字/号 yet. */
  const missingAlias = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE") &&
        !overview.personStats[p.id]?.claimTypes.includes("ALIAS")
    );
  }, [overview, sortedPersons]);

  /** Birth known but no story yet. */
  const missingStory = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) =>
        overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE") &&
        !overview.personStats[p.id]?.claimTypes.includes("STORY")
    );
  }, [overview, sortedPersons]);

  /** Has a generation from real kin edges, but no 字辈 claim yet. */
  const missingGenerationWord = useMemo(() => {
    if (!overview || !generationByPerson || relationships.length === 0) {
      return [];
    }
    return sortedPersons.filter(
      (p) =>
        generationByPerson[p.id] != null &&
        !overview.personStats[p.id]?.claimTypes.includes("GENERATION_WORD")
    );
  }, [overview, generationByPerson, sortedPersons, relationships.length]);

  const missingGender = useMemo(
    () =>
      sortedPersons.filter((p) => !p.gender || p.gender === "UNKNOWN"),
    [sortedPersons]
  );

  const missingLiving = useMemo(
    () =>
      sortedPersons.filter(
        (p) => !p.livingStatus || p.livingStatus === "UNKNOWN"
      ),
    [sortedPersons]
  );

  /** Children who share a parent with at least one sibling, but have no 排行. */
  const missingBirthOrder = useMemo(() => {
    if (!overview) return [];
    const childrenByParent = new Map<string, string[]>();
    for (const r of relationships) {
      if (r.type && !PARENT_REL_TYPES.has(r.type)) continue;
      if (r.type === "SPOUSE") continue;
      const list = childrenByParent.get(r.fromPersonId) ?? [];
      list.push(r.toPersonId);
      childrenByParent.set(r.fromPersonId, list);
    }
    const withSiblings = new Set<string>();
    for (const kids of childrenByParent.values()) {
      if (kids.length < 2) continue;
      for (const id of kids) withSiblings.add(id);
    }
    return sortedPersons.filter(
      (p) =>
        withSiblings.has(p.id) &&
        !overview.personStats[p.id]?.claimTypes.includes("BIRTH_ORDER")
    );
  }, [overview, relationships, sortedPersons]);

  const acceptedTotal = overview?.acceptedTotal ?? 0;
  const sourcedAcceptedTotal = overview?.sourcedAcceptedTotal ?? 0;
  const unsourcedAccepted = overview?.unsourcedAccepted ?? [];
  const unsourcedAcceptedTotal = overview?.unsourcedAcceptedTotal ?? 0;

  const unsourcedPeople = useMemo(() => {
    if (!overview || unsourcedAccepted.length === 0) return [] as Person[];
    const seen = new Set<string>();
    const out: Person[] = [];
    for (const c of unsourcedAccepted) {
      if (seen.has(c.personId)) continue;
      seen.add(c.personId);
      const person = sortedPersons.find((p) => p.id === c.personId);
      if (person) out.push(person);
    }
    return out;
  }, [overview, unsourcedAccepted, sortedPersons]);

  const total = persons.length;
  const connectedCount = total - unconnected.length;
  const birthCount = overview ? total - missingBirth.length : null;
  const pendingTotal = overview?.pendingTotal ?? 0;

  const smartPendingIds = useMemo(() => {
    if (!overview) return [] as string[];
    return overview.pending
      .filter(
        (c) =>
          c.status === "PROPOSED" &&
          (c.originType === "AI_EXTRACTION" || c.originType === "IMPORT")
      )
      .map((c) => c.claimId);
  }, [overview]);

  const smartBatchCount = Math.min(20, smartPendingIds.length);

  const reviewSmartPending = useCallback(
    async (action: "accept" | "reject") => {
      if (!canReview || smartPendingIds.length === 0 || batchBusy) return;
      setBatchBusy(true);
      setBatchFlash("");
      setBatchUndo(null);
      setLoadError("");
      try {
        const claimIds = smartPendingIds.slice(0, 20);
        const r = await v1api.reviewClaimsBatch(
          familyId,
          { action, claimIds },
          { idempotencyKey: crypto.randomUUID() }
        );
        const verb = action === "accept" ? "确认" : "不采用";
        const more =
          smartPendingIds.length > claimIds.length
            ? `；列表内还有 ${smartPendingIds.length - claimIds.length} 条可再点一次`
            : "";
        const succeededIds = r.results
          .filter(
            (row): row is {
              index: number;
              ok: true;
              claim: { id: string; status: string };
            } => row.ok
          )
          .map((row) => row.claim.id);
        if (succeededIds.length > 0) {
          setBatchUndo({ kind: action, claimIds: succeededIds });
          setBatchFlash(
            r.failed > 0
              ? `已${verb} ${r.succeeded} 条智能整理，${r.failed} 条未成功。误操作可点恢复。${more}`
              : `已${verb} ${r.succeeded} 条智能整理。误操作可点恢复。${more}`
          );
        } else {
          setBatchFlash(
            r.failed > 0
              ? `已${verb} ${r.succeeded} 条智能整理，${r.failed} 条未成功${more}`
              : `已${verb} ${r.succeeded} 条智能整理${more}`
          );
        }
        await load();
        await onReload?.();
      } catch (e) {
        if (onAuthError(e)) return;
        setLoadError(userMessageForApiError(e));
      } finally {
        setBatchBusy(false);
      }
    },
    [
      batchBusy,
      canReview,
      familyId,
      load,
      onAuthError,
      onReload,
      smartPendingIds,
    ]
  );

  const undoBatchReview = useCallback(async () => {
    const undo = batchUndo;
    if (!undo?.claimIds.length || batchBusy) return;
    setBatchBusy(true);
    setBatchUndo(null);
    setLoadError("");
    try {
      let ok = 0;
      for (const claimId of undo.claimIds) {
        try {
          if (undo.kind === "accept") {
            await v1api.rejectClaim(familyId, claimId, {
              idempotencyKey: crypto.randomUUID(),
            });
          }
          await v1api.reopenClaim(familyId, claimId, {
            idempotencyKey: crypto.randomUUID(),
          });
          ok += 1;
        } catch {
          /* continue remaining */
        }
      }
      setBatchFlash(
        ok > 0
          ? `已重新打开 ${ok} 条资料，可再次确认或不采用`
          : "恢复失败，请稍后在「可恢复」或最近动态中逐条找回"
      );
      await load();
      await onReload?.();
    } catch (e) {
      if (onAuthError(e)) return;
      setLoadError(userMessageForApiError(e));
    } finally {
      setBatchBusy(false);
    }
  }, [batchBusy, batchUndo, familyId, load, onAuthError, onReload]);

  type Step = {
    key: string;
    title: string;
    body: string;
    action?: { label: string; onClick: () => void };
    people?: Person[];
    peopleAria?: string;
    /** When true, people chips open the person (read) instead of capture actions. */
    browsePeople?: boolean;
  };

  const steps: Step[] = [];
  if (total === 0) {
    steps.push({
      key: "first",
      title: canEdit ? "添加第一位家人" : "还没有家族成员",
      body: canEdit
        ? "从你最熟悉的长辈开始，姓名或常用称呼就够了。"
        : "有编辑权限的家人添加成员后，名单会出现在这里。",
      action: canEdit ? { label: "添加成员", onClick: onAddPerson } : undefined,
    });
  } else if (total === 1) {
    steps.push({
      key: "second",
      title: canEdit ? "再添加一位家人" : "档案里只有一位成员",
      body: canEdit
        ? "有两位成员后，就能建立父母或配偶关系，世系开始成形。"
        : "有编辑权限的家人再补一位后，才能建立关系、排进世代。",
      action: canEdit ? { label: "添加成员", onClick: onAddPerson } : undefined,
    });
  }
  if (total >= 2 && unconnected.length > 0) {
    steps.push({
      key: "connect",
      title: canEdit
        ? `为 ${unconnected.length} 位成员建立关系`
        : `还有 ${unconnected.length} 位成员未连入世系`,
      body: canEdit
        ? "还没有父母或配偶关系，暂时无法排进世代。点人名可为 TA 添加父母（也可在弹窗里改成配偶或子女）。"
        : "还没有父母或配偶关系，暂时无法排进世代。可先打开人物页了解他们；有编辑权限的家人补上关系后，世系会出现。",
      people: unconnected.slice(0, 6),
      peopleAria: canEdit ? "建立关系" : "查看",
      browsePeople: !canEdit,
    });
  } else if (componentCount > 1) {
    steps.push({
      key: "branches",
      title: canEdit
        ? `连接 ${componentCount} 个家族分支`
        : `档案里有 ${componentCount} 个尚未连接的分支`,
      body: canEdit
        ? "档案里有几支还没有连在一起。点较小分支里的人名，可为 TA 添加父母或配偶，与主支连上。"
        : "几支还没有连在一起。可先打开较小分支里的人物页；有编辑权限的家人补上关系后，会并入主支。",
      people: branchReps.length > 0 ? branchReps : undefined,
      peopleAria: canEdit ? "连接分支" : "查看",
      browsePeople: !canEdit,
      action: canEdit
        ? { label: "添加家庭关系", onClick: onAddRel }
        : undefined,
    });
  }
  const peopleChips = (
    list: Person[],
    editAria: string
  ): Pick<Step, "people" | "peopleAria" | "browsePeople"> => ({
    people: list.slice(0, 6),
    peopleAria: canEdit ? editAria : "查看",
    browsePeople: !canEdit,
  });
  const viewerReadHint =
    "可先打开人物页了解；有编辑权限的家人补充后，这里会更新。";

  if (missingSpouse.length > 0) {
    steps.push({
      key: "spouse",
      title: canEdit
        ? `补充 ${missingSpouse.length} 位已有子女成员的配偶`
        : `${missingSpouse.length} 位已有子女的成员还没有配偶记录`,
      body: canEdit
        ? "已有子女的人补上配偶，世系和打印版家谱会更完整。也可以先跳过。"
        : viewerReadHint,
      ...peopleChips(missingSpouse, "补充配偶"),
    });
  }
  if (missingChildren.length > 0) {
    steps.push({
      key: "children",
      title: canEdit
        ? `补充 ${missingChildren.length} 位已有配偶成员的子女`
        : `${missingChildren.length} 位已有配偶的成员还没有子女记录`,
      body: canEdit
        ? "已有配偶的人补上子女，世系和打印版家谱会更完整。也可以先跳过。"
        : viewerReadHint,
      ...peopleChips(missingChildren, "补充子女"),
    });
  }
  if (missingParents.length > 0) {
    steps.push({
      key: "parents",
      title: canEdit
        ? `补充 ${missingParents.length} 位已有亲人成员的父母`
        : `${missingParents.length} 位已有亲人的成员还没有父母记录`,
      body: canEdit
        ? "已有配偶或子女的人补上父母，世系向上更完整。也可以先跳过。"
        : viewerReadHint,
      ...peopleChips(missingParents, "补充父母"),
    });
  }
  if (overview && total > 0 && missingBirth.length > 0) {
    steps.push({
      key: "birth",
      title: canEdit
        ? `补充 ${missingBirth.length} 位成员的出生信息`
        : `${missingBirth.length} 位成员还没有出生信息`,
      body: canEdit
        ? "出生年代是排辈、核对来源最常用的线索，大概的年份也可以。"
        : viewerReadHint,
      ...peopleChips(missingBirth, "补充出生信息"),
    });
  }
  if (overview && missingBirthPlace.length > 0) {
    steps.push({
      key: "birthPlace",
      title: canEdit
        ? `补充 ${missingBirthPlace.length} 位成员的出生地`
        : `${missingBirthPlace.length} 位成员还没有出生地`,
      body: canEdit
        ? "有了出生年代后，补上出生地，后人核对族谱页会更容易。"
        : viewerReadHint,
      ...peopleChips(missingBirthPlace, "补充出生地"),
    });
  }
  if (overview && missingDeath.length > 0) {
    steps.push({
      key: "death",
      title: canEdit
        ? `补充 ${missingDeath.length} 位已故成员的去世信息`
        : `${missingDeath.length} 位已故成员还没有去世信息`,
      body: canEdit
        ? "标为已故后，补上大概的卒年，后人查阅和排谱会清楚很多。"
        : viewerReadHint,
      ...peopleChips(missingDeath, "补充去世信息"),
    });
  } else if (overview && missingBurial.length > 0) {
    steps.push({
      key: "burial",
      title: canEdit
        ? `补充 ${missingBurial.length} 位已故成员的安葬地`
        : `${missingBurial.length} 位已故成员还没有安葬地`,
      body: canEdit
        ? "安葬地是扫墓与核对族谱页的重要线索，记得不清楚也可以先写大概位置。"
        : viewerReadHint,
      ...peopleChips(missingBurial, "补充安葬地"),
    });
  }
  if (overview && total > 0 && missingAncestral.length > 0) {
    steps.push({
      key: "ancestral",
      title: canEdit
        ? `补充 ${missingAncestral.length} 位成员的祖籍`
        : `${missingAncestral.length} 位成员还没有祖籍`,
      body: canEdit
        ? "祖籍是认亲、核对旧谱最常用的线索，写到县或村一级就可以。"
        : viewerReadHint,
      ...peopleChips(missingAncestral, "补充祖籍"),
    });
  }
  if (overview && missingOccupation.length > 0) {
    steps.push({
      key: "occupation",
      title: canEdit
        ? `补充 ${missingOccupation.length} 位成员的职业`
        : `${missingOccupation.length} 位成员还没有职业`,
      body: canEdit
        ? "职事与身份便于认亲和核对旧谱，知县、商贾、务农等写清楚即可。"
        : viewerReadHint,
      ...peopleChips(missingOccupation, "补充职业"),
    });
  }
  if (overview && missingAlias.length > 0) {
    steps.push({
      key: "alias",
      title: canEdit
        ? `补充 ${missingAlias.length} 位成员的字号`
        : `${missingAlias.length} 位成员还没有字号`,
      body: canEdit
        ? "字、号、乳名等便于认亲和对照旧谱称呼，写一条常用的即可。"
        : viewerReadHint,
      ...peopleChips(missingAlias, "补充字号"),
    });
  }
  if (overview && missingStory.length > 0) {
    steps.push({
      key: "story",
      title: canEdit
        ? `补充 ${missingStory.length} 位成员的故事或口述`
        : `${missingStory.length} 位成员还没有故事或口述`,
      body: canEdit
        ? "记下口碑、功绩或迁居缘起，一两段也可以；可注明讲述人。"
        : viewerReadHint,
      ...peopleChips(missingStory, "补充故事"),
    });
  }
  if (overview && missingGenerationWord.length > 0) {
    steps.push({
      key: "generationWord",
      title: canEdit
        ? `补充 ${missingGenerationWord.length} 位成员的字辈`
        : `${missingGenerationWord.length} 位成员还没有字辈`,
      body: canEdit
        ? "有了世代后，补上字辈，世系标题与打印版家谱会按辈分更清楚。同辈常用同一个字。"
        : viewerReadHint,
      ...peopleChips(missingGenerationWord, "补充字辈"),
    });
  }
  if (overview && missingBirthOrder.length > 0) {
    steps.push({
      key: "birthOrder",
      title: canEdit
        ? `补充 ${missingBirthOrder.length} 位兄弟姐妹的排行`
        : `${missingBirthOrder.length} 位兄弟姐妹还没有排行`,
      body: canEdit
        ? "同一父母下有多位子女时，补上长/次/三…，人物页与打印版的子女顺序会更清楚。"
        : viewerReadHint,
      ...peopleChips(missingBirthOrder, "补充排行"),
    });
  }
  // Living status unlocks death/burial capture — nudge once the tree is connected.
  if (overview && missingLiving.length > 0 && unconnected.length === 0) {
    steps.push({
      key: "living",
      title: canEdit
        ? `确认 ${missingLiving.length} 位成员是否在世`
        : `${missingLiving.length} 位成员的在世状态尚不确定`,
      body: canEdit
        ? "还标成「不确定」的，在人物卡片里改成在世或已故；标为已故后才能提示补去世与安葬信息。"
        : viewerReadHint,
      ...peopleChips(missingLiving, "确认在世状态"),
    });
  }
  // Gender is person basics (drawer), not a claim — only nudge after births are in.
  if (
    overview &&
    missingGender.length > 0 &&
    unconnected.length === 0 &&
    missingBirth.length === 0
  ) {
    steps.push({
      key: "gender",
      title: canEdit
        ? `确认 ${missingGender.length} 位成员的性别`
        : `${missingGender.length} 位成员的性别尚不确定`,
      body: canEdit
        ? "性别还标成「不确定」的，在人物卡片里改一下，排谱和称呼会更顺。"
        : viewerReadHint,
      ...peopleChips(missingGender, "确认性别"),
    });
  }
  if (overview && unsourcedAcceptedTotal > 0) {
    steps.push({
      key: "source",
      title: canEdit
        ? `为 ${unsourcedAcceptedTotal} 条已确认资料补上来源`
        : `${unsourcedAcceptedTotal} 条已确认资料还没有来源`,
      body: canEdit
        ? "有出处的资料才经得起后人核对。点人名打开那条资料并挂上来源；谱页、口述、照片都可以。"
        : "可先打开人物页查看；有编辑权限的家人补上来源后，这里会更新。",
      people: unsourcedPeople.slice(0, 6),
      peopleAria: canEdit ? "补上来源" : "查看",
      browsePeople: !canEdit,
    });
  }
  if (pendingTotal > 0) {
    steps.push({
      key: "review",
      title: canReview
        ? `处理 ${pendingTotal} 条待确认资料`
        : `${pendingTotal} 条资料等待确认`,
      body: canReview
        ? "确认或标记不采用后，资料会在人物档案中正式生效。"
        : "创建者或管理员确认后，资料会正式生效。",
      action: {
        label: canReview ? "去确认" : "查看待确认",
        onClick: () => {
          document
            .getElementById("overview-pending")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
    });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="overview-progress">
        <h2
          id="overview-progress"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          档案进度
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ProgressTile label="家族成员" value={`${total} 位`} />
          <ProgressTile
            label="已连入世系"
            value={total ? `${connectedCount} / ${total}` : "—"}
            ratio={total ? connectedCount / total : undefined}
          />
          <ProgressTile
            label="有出生信息"
            value={
              birthCount === null ? "…" : total ? `${birthCount} / ${total}` : "—"
            }
            ratio={birthCount !== null && total ? birthCount / total : undefined}
          />
          <ProgressTile
            label="有出处资料"
            value={
              overview
                ? acceptedTotal
                  ? `${sourcedAcceptedTotal} / ${acceptedTotal}`
                  : "0 条"
                : "…"
            }
            ratio={
              overview && acceptedTotal
                ? sourcedAcceptedTotal / acceptedTotal
                : undefined
            }
          />
        </dl>
        {loadError ? (
          <div className="mt-3 flex items-center gap-3 alpha-alert alpha-alert-error" role="alert">
            <p className="min-w-0 flex-1">{loadError}</p>
            <button
              type="button"
              className="shrink-0 text-sm font-semibold underline-offset-2 hover:underline"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="overview-next">
        <h2
          id="overview-next"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          下一步
        </h2>
        {steps.length === 0 ? (
          <div className="alpha-panel px-4 py-5">
            <p className="font-semibold text-[color:var(--a-ink)]">
              {overview ? "这份档案很扎实" : "正在汇总档案…"}
            </p>
            {overview ? (
              <>
                <p className="mt-1 text-sm text-[color:var(--a-muted)]">
                  {canReview
                    ? "成员都已连入世系，关键事实与已确认资料的来源也齐了，也没有待确认资料。可以邀请家人一起维护，或打开打印版家谱。"
                    : canEdit
                      ? "成员都已连入世系，关键事实与已确认资料的来源也齐了，也没有待确认资料。需要新成员加入时，请联系创建者或管理员生成邀请；也可打开打印版家谱。"
                      : "成员都已连入世系，关键事实与已确认资料的来源也齐了，也没有待确认资料。可以浏览资料来源，或打开打印版家谱。"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canReview ? (
                    <button
                      type="button"
                      className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
                      onClick={() =>
                        document
                          .getElementById("overview-invite")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                    >
                      邀请家人
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
                    onClick={() =>
                      document
                        .getElementById("overview-sources")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                    }
                  >
                    资料来源
                  </button>
                  <Link
                    href={`/alpha/families/${familyId}/print`}
                    className="alpha-btn alpha-btn-primary !min-h-[40px] !text-sm"
                  >
                    打印版家谱
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.key} className="alpha-panel flex gap-3 px-4 py-4">
                <span
                  className="alpha-font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--a-brand-soft)] text-sm font-bold text-[color:var(--a-brand)]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[color:var(--a-ink)]">{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[color:var(--a-muted)]">
                    {s.body}
                  </p>
                  {s.people && s.people.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.people.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (s.browsePeople) {
                              onOpenPerson?.(p.id);
                              return;
                            }
                            if (s.key === "connect" || s.key === "branches") {
                              onAddKin?.(p.id, "parent");
                              return;
                            }
                            if (s.key === "spouse") {
                              onAddKin?.(p.id, "spouse");
                              return;
                            }
                            if (s.key === "children") {
                              onAddKin?.(p.id, "child");
                              return;
                            }
                            if (s.key === "parents") {
                              onAddKin?.(p.id, "parent");
                              return;
                            }
                            if (s.key === "living") {
                              onOpenPerson?.(p.id, "living");
                              return;
                            }
                            if (s.key === "gender") {
                              onOpenPerson?.(p.id, "gender");
                              return;
                            }
                            if (s.key === "source") {
                              const first = unsourcedAccepted.find(
                                (c) => c.personId === p.id
                              );
                              if (first) {
                                onOpenRecords(p.id, {
                                  focusClaimId: first.claimId,
                                  statusFilter: "ALL",
                                  openEvidence: true,
                                });
                              } else {
                                onOpenPerson?.(p.id);
                              }
                              return;
                            }
                            onOpenRecords(
                              p.id,
                              s.key === "birth"
                                ? "BIRTH_DATE"
                                : s.key === "birthPlace"
                                  ? "BIRTH_PLACE"
                                  : s.key === "death"
                                    ? "DEATH_DATE"
                                    : s.key === "burial"
                                      ? "BURIAL_PLACE"
                                      : s.key === "ancestral"
                                        ? "ANCESTRAL_PLACE"
                                        : s.key === "occupation"
                                          ? "OCCUPATION"
                                          : s.key === "alias"
                                            ? "ALIAS"
                                            : s.key === "story"
                                              ? "STORY"
                                              : s.key === "generationWord"
                                                ? "GENERATION_WORD"
                                                : s.key === "birthOrder"
                                                  ? "BIRTH_ORDER"
                                                  : undefined
                            );
                          }}
                          className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                          aria-label={
                            s.browsePeople
                              ? `查看${p.preferredName}`
                              : `为${p.preferredName}${s.peopleAria ?? "补充资料"}`
                          }
                        >
                          {p.preferredName}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {s.action ? (
                    <button
                      type="button"
                      onClick={s.action.onClick}
                      className="alpha-btn alpha-btn-primary mt-3 !min-h-[40px] !text-sm"
                    >
                      {s.action.label}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        {!canEdit ? (
          <p className="mt-2 text-sm text-[color:var(--a-muted)]">
            你目前是只读成员，可以浏览全部内容。
          </p>
        ) : null}
      </section>

      {batchFlash ? (
        <div
          className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--a-brand)]"
          role="status"
        >
          <p className="min-w-0 flex-1">{batchFlash}</p>
          {batchUndo?.claimIds.length ? (
            <button
              type="button"
              disabled={batchBusy}
              className="shrink-0 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
              onClick={() => void undoBatchReview()}
            >
              恢复
            </button>
          ) : null}
          <button
            type="button"
            className="shrink-0 text-[color:var(--a-muted)] underline-offset-2 hover:underline"
            onClick={() => {
              setBatchFlash("");
              setBatchUndo(null);
            }}
          >
            关闭
          </button>
        </div>
      ) : null}

      {overview && overview.pending.length > 0 ? (
        <section
          aria-labelledby="overview-pending"
          aria-label="待确认资料"
        >
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2
              id="overview-pending"
              className="text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
            >
              待确认资料
              {overview.pendingTotal > overview.pending.length
                ? `（优先 ${overview.pending.length} 条，共 ${overview.pendingTotal} 条）`
                : `（${overview.pendingTotal}）`}
            </h2>
            {canReview && smartPendingIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={batchBusy}
                  onClick={() => void reviewSmartPending("accept")}
                  className="alpha-btn alpha-btn-primary shrink-0 !min-h-[40px] !px-3 !text-sm disabled:opacity-60"
                >
                  {batchBusy
                    ? "处理中…"
                    : smartPendingIds.length > 20
                      ? `确认前 ${smartBatchCount} 条智能整理`
                      : `确认 ${smartBatchCount} 条智能整理`}
                </button>
                <button
                  type="button"
                  disabled={batchBusy}
                  onClick={() => void reviewSmartPending("reject")}
                  className="alpha-btn alpha-btn-secondary shrink-0 !min-h-[40px] !px-3 !text-sm disabled:opacity-60"
                >
                  {smartPendingIds.length > 20
                    ? `不采用前 ${smartBatchCount} 条`
                    : "不采用这些"}
                </button>
              </div>
            ) : null}
          </div>
          {smartPendingIds.length > 0 && !canReview ? (
            <p className="mb-2 text-sm text-[color:var(--a-muted)]">
              其中有智能整理写入的资料，需管理员确认后才会成为正式记载。
            </p>
          ) : null}
          <ul className="space-y-2">
            {overview.pending.map((c) => {
              const name = personName.get(c.personId) ?? "成员";
              const typeLabel = CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType;
              const statusLabel =
                CLAIM_STATUS_LABEL[c.status as keyof typeof CLAIM_STATUS_LABEL] ??
                c.status;
              const originLabel =
                c.originType === "AI_EXTRACTION" || c.originType === "IMPORT"
                  ? CLAIM_ORIGIN_LABEL[
                      c.originType as keyof typeof CLAIM_ORIGIN_LABEL
                    ]
                  : null;
              return (
                <li key={c.claimId}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenRecords(c.personId, {
                        focusClaimId: c.claimId,
                        statusFilter:
                          c.status === "CONFLICTED" ? "CONFLICTED" : "PROPOSED",
                      })
                    }
                    className="alpha-panel alpha-panel-interactive flex w-full min-h-[56px] items-center justify-between gap-3 px-4 py-2 text-left"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[color:var(--a-ink)]">
                        {name}
                        <span className="font-normal text-[color:var(--a-muted)]">
                          {" · "}
                          {typeLabel}
                        </span>
                      </p>
                      <p className="truncate text-sm text-[color:var(--a-muted)]">
                        {c.text ?? "—"}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      {originLabel ? (
                        <span className="alpha-chip alpha-chip-proposed">
                          {originLabel}
                        </span>
                      ) : null}
                      <span
                        className={`alpha-chip ${
                          c.status === "CONFLICTED"
                            ? "alpha-chip-conflicted"
                            : "alpha-chip-proposed"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span className="text-sm font-semibold text-[color:var(--a-brand)]">
                        {canReview
                          ? c.status === "CONFLICTED"
                            ? "去选用说法"
                            : "去确认"
                          : "查看"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {(() => {
        const restorable = (activity ?? []).filter((item) => {
          if (!item.restorable) return false;
          if (item.eventType === "PERSON_DELETED")
            return Boolean(canReview && onRestorePerson && item.personId);
          if (item.eventType === "RELATIONSHIP_DELETED")
            return Boolean(
              canEdit && onRestoreRelationship && item.relationshipId
            );
          if (item.eventType === "EVIDENCE_DELETED")
            return Boolean(canReview && onRestoreEvidence && item.evidenceId);
          if (item.eventType === "CLAIM_REJECTED")
            return Boolean(
              canReview && onReopenClaim && item.claimId && item.personId
            );
          return false;
        });
        if (restorable.length === 0) return null;
        return (
          <section
            id="overview-restorable"
            aria-labelledby="overview-restorable-title"
            className="scroll-mt-24"
          >
            <h2
              id="overview-restorable-title"
              className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
            >
              可恢复
            </h2>
            <ul className="alpha-panel divide-y divide-[color:var(--a-brand-line)]">
              {restorable.slice(0, 8).map((item) => {
                const label =
                  item.eventType === "PERSON_DELETED"
                    ? `成员「${item.personName ?? "未命名"}」`
                    : item.eventType === "RELATIONSHIP_DELETED"
                      ? "一条家庭关系"
                      : item.eventType === "EVIDENCE_DELETED"
                        ? `资料来源${item.evidenceType ? `（${EVIDENCE_TYPE_UI[item.evidenceType] ?? item.evidenceType}）` : ""}`
                        : item.eventType === "CLAIM_REJECTED"
                          ? `不采用的${CLAIM_TYPE_UI[item.claimType ?? ""]?.label ?? "资料"}`
                          : "一条记录";
                return (
                  <li
                    key={`restorable-${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <p className="min-w-0 text-[color:var(--a-ink)]">
                      {label}
                      <span className="text-[color:var(--a-muted)]">
                        {" · "}
                        {relativeTimeLabel(item.at)}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                      onClick={() => {
                        if (
                          item.eventType === "PERSON_DELETED" &&
                          item.personId
                        ) {
                          void onRestorePerson?.(item.personId);
                        } else if (
                          item.eventType === "RELATIONSHIP_DELETED" &&
                          item.relationshipId
                        ) {
                          void onRestoreRelationship?.(item.relationshipId);
                        } else if (
                          item.eventType === "EVIDENCE_DELETED" &&
                          item.evidenceId
                        ) {
                          void onRestoreEvidence?.(item.evidenceId);
                        } else if (
                          item.eventType === "CLAIM_REJECTED" &&
                          item.claimId &&
                          item.personId
                        ) {
                          void onReopenClaim?.(item.personId, item.claimId);
                        }
                      }}
                    >
                      恢复
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {activity && activity.length > 0 ? (
        <section aria-labelledby="overview-activity">
          <h2
            id="overview-activity"
            className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
          >
            最近动态
          </h2>
          <ol className="alpha-panel divide-y divide-[color:var(--a-brand-line)]">
            {activity.map((item) => {
              const pieces = activityPieces(item);
              if (!pieces) return null;
              const claimFocus =
                item.claimId && item.personId
                  ? {
                      personId: item.personId,
                      claimId: item.claimId,
                      // Always 全部 — CLAIM_CREATED rows outlive 待确认;
                      // a hard PROPOSED filter hides confirmed/conflicted cards.
                      statusFilter: "ALL" as const,
                    }
                  : null;
              return (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm"
                >
                  <p className="min-w-0 leading-relaxed text-[color:var(--a-ink)]">
                    <span className="font-semibold">{actorLabel(item.actor)}</span>{" "}
                    {pieces.map((piece, i) =>
                      typeof piece === "string" ? (
                        <Fragment key={i}>{piece}</Fragment>
                      ) : (
                        <Link
                          key={i}
                          href={`/alpha/families/${familyId}/people/${piece.personId}`}
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        >
                          {piece.name}
                        </Link>
                      )
                    )}
                    {claimFocus ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() =>
                            onOpenRecords(claimFocus.personId, {
                              focusClaimId: claimFocus.claimId,
                              statusFilter: claimFocus.statusFilter,
                            })
                          }
                        >
                          查看
                        </button>
                      </>
                    ) : null}
                    {item.eventType === "CLAIM_REJECTED" &&
                    item.restorable &&
                    item.claimId &&
                    item.personId &&
                    canReview &&
                    onReopenClaim ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() =>
                            void onReopenClaim(item.personId!, item.claimId!)
                          }
                        >
                          恢复
                        </button>
                      </>
                    ) : null}
                    {(item.eventType === "EVIDENCE_CREATED" ||
                      item.eventType === "EVIDENCE_RESTORED") &&
                    item.evidenceId ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() => setFocusEvidenceId(item.evidenceId!)}
                        >
                          查看
                        </button>
                      </>
                    ) : null}
                    {item.eventType === "EVIDENCE_DELETED" &&
                    item.restorable &&
                    item.evidenceId &&
                    canReview &&
                    onRestoreEvidence ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() =>
                            void onRestoreEvidence(item.evidenceId!)
                          }
                        >
                          恢复
                        </button>
                      </>
                    ) : null}
                    {(item.eventType === "RELATIONSHIP_CREATED" ||
                      item.eventType === "RELATIONSHIP_DELETED" ||
                      item.eventType === "RELATIONSHIP_RESTORED") &&
                    onOpenLineage &&
                    item.personId ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() => onOpenLineage(item.personId!)}
                        >
                          查看
                        </button>
                      </>
                    ) : null}
                    {item.eventType === "RELATIONSHIP_DELETED" &&
                    item.restorable &&
                    item.relationshipId &&
                    canEdit &&
                    onRestoreRelationship ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() =>
                            void onRestoreRelationship(item.relationshipId!)
                          }
                        >
                          恢复
                        </button>
                      </>
                    ) : null}
                    {item.eventType === "PERSON_DELETED" &&
                    item.restorable &&
                    item.personId &&
                    canReview &&
                    onRestorePerson ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          onClick={() => void onRestorePerson(item.personId!)}
                        >
                          恢复
                        </button>
                      </>
                    ) : null}
                  </p>
                  <time
                    dateTime={item.at}
                    className="shrink-0 text-xs text-[color:var(--a-muted)]"
                  >
                    {relativeTimeLabel(item.at)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {canReview ? (
        <FamilyInvites
          familyId={familyId}
          onAuthError={onAuthError}
          onMembershipChanged={() => {
            void load();
          }}
        />
      ) : null}

      <FamilySources
        familyId={familyId}
        persons={persons}
        onAuthError={onAuthError}
        onOpenRecords={onOpenRecords}
        onAddPerson={onAddPerson}
        canEdit={canEdit}
        canManage={canReview}
        onRemoved={(evidenceId, label) => {
          onEvidenceRemoved?.(evidenceId, label);
          void load();
          void onReload?.();
        }}
        onCreated={() => {
          void load();
          void onReload?.();
        }}
        onLinked={() => {
          void load();
          void onReload?.();
        }}
        focusEvidenceId={focusEvidenceId}
        onFocusEvidenceConsumed={() => setFocusEvidenceId(null)}
        dataVersion={dataVersion}
      />

      <BackupSection familyId={familyId} onAuthError={onAuthError} />
    </div>
  );
}

function backupFileName(displayName: string, at: Date, ext: string): string {
  const safe = displayName.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
  const ymd = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  return `${safe || "家族"}-备份-${ymd}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupSection({
  familyId,
  onAuthError,
}: {
  familyId: string;
  onAuthError: (e: unknown) => boolean;
}) {
  const [busy, setBusy] = useState<"json" | "ged" | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function download(kind: "json" | "ged") {
    setBusy(kind);
    setMessage("");
    setFailed(false);
    try {
      const { export: data } = await v1api.exportFamily(familyId);
      const now = new Date();
      if (kind === "json") {
        triggerDownload(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
          backupFileName(data.family.displayName, now, "json")
        );
        setMessage(`已生成备份：${data.persons.length} 位成员`);
      } else {
        triggerDownload(
          new Blob([gedcomFromExport(data)], {
            type: "text/plain;charset=utf-8",
          }),
          backupFileName(data.family.displayName, now, "ged")
        );
        setMessage(`已生成 GEDCOM：${data.persons.length} 位成员`);
      }
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="overview-backup">
      <h2
        id="overview-backup"
        className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
      >
        备份
      </h2>
      <div className="alpha-panel px-4 py-4">
        <p className="text-sm leading-relaxed text-[color:var(--a-muted)]">
          下载一份你能看到的成员、关系、资料与来源，自己保存一份，更安心。照片等原件不包含在文件里。也可以导出 GEDCOM 给其他族谱软件，或生成按代排列的打印版。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void download("json")}
            disabled={busy !== null}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
          >
            {busy === "json" ? "正在整理…" : "下载家族备份"}
          </button>
          <button
            type="button"
            onClick={() => void download("ged")}
            disabled={busy !== null}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
          >
            {busy === "ged" ? "正在整理…" : "导出 GEDCOM"}
          </button>
          <Link
            href={`/alpha/families/${familyId}/print`}
            className="alpha-btn alpha-btn-secondary inline-flex !min-h-[40px] !text-sm"
          >
            打印版家谱
          </Link>
        </div>
        {message ? (
          <p
            role={failed ? "alert" : "status"}
            className={`mt-2 text-sm ${
              failed
                ? "text-[color:var(--a-danger)]"
                : "text-[color:var(--a-brand)]"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ProgressTile({
  label,
  value,
  ratio,
}: {
  label: string;
  value: string;
  ratio?: number;
}) {
  return (
    <div className="alpha-panel px-3 py-3">
      <dt className="text-xs font-semibold text-[color:var(--a-muted)]">{label}</dt>
      <dd className="alpha-font-display mt-1 text-xl font-bold text-[color:var(--a-ink)]">
        {value}
      </dd>
      {ratio !== undefined ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--a-brand-soft)]"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[color:var(--a-brand)]"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
