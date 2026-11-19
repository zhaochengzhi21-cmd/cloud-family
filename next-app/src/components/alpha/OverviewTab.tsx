"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
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

type Person = { id: string; preferredName: string; livingStatus?: string };
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
      return ["移除了一位成员"];
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
    case "CLAIM_CREATED":
      return p ? ["为「", p, `」添加了${claimLabel}`] : null;
    case "CLAIM_ACCEPTED":
      return p ? ["确认了「", p, `」的${claimLabel}`] : null;
    case "CLAIM_REJECTED":
      return p ? ["不采用「", p, `」的一条${claimLabel}`] : null;
    case "EVIDENCE_CREATED": {
      const t = item.evidenceType ? EVIDENCE_TYPE_UI[item.evidenceType] : null;
      return [t ? `添加了一条资料来源（${t}）` : "添加了一条资料来源"];
    }
    case "EVIDENCE_DELETED":
      return ["移除了一条资料来源"];
    case "MEMBER_JOINED":
      return ["通过邀请加入了家族"];
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
  onOpenRecords,
  onAuthError,
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
  onAddKin?: (personId: string, role: "parent" | "spouse") => void;
  onOpenRecords: (personId: string, claimType?: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [ov, act] = await Promise.all([
        v1api.getOverview(familyId),
        v1api.getActivity(familyId),
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

  /** Has a generation from the graph, but no 字辈 claim yet. */
  const missingGenerationWord = useMemo(() => {
    if (!overview || !generationByPerson) return [];
    return sortedPersons.filter(
      (p) =>
        generationByPerson[p.id] != null &&
        !overview.personStats[p.id]?.claimTypes.includes("GENERATION_WORD")
    );
  }, [overview, generationByPerson, sortedPersons]);

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

  const acceptedTotal = useMemo(() => {
    if (!overview) return 0;
    return Object.values(overview.personStats).reduce(
      (n, s) => n + s.accepted,
      0
    );
  }, [overview]);

  const total = persons.length;
  const connectedCount = total - unconnected.length;
  const birthCount = overview ? total - missingBirth.length : null;
  const pendingTotal = overview?.pendingTotal ?? 0;

  type Step = {
    key: string;
    title: string;
    body: string;
    action?: { label: string; onClick: () => void };
    people?: Person[];
    peopleAria?: string;
  };

  const steps: Step[] = [];
  if (total === 0) {
    steps.push({
      key: "first",
      title: "添加第一位家人",
      body: "从你最熟悉的长辈开始，姓名或常用称呼就够了。",
      action: canEdit ? { label: "添加成员", onClick: onAddPerson } : undefined,
    });
  } else if (total === 1) {
    steps.push({
      key: "second",
      title: "再添加一位家人",
      body: "有两位成员后，就能建立父母或配偶关系，世系开始成形。",
      action: canEdit ? { label: "添加成员", onClick: onAddPerson } : undefined,
    });
  }
  if (total >= 2 && unconnected.length > 0) {
    steps.push({
      key: "connect",
      title: `为 ${unconnected.length} 位成员建立关系`,
      body: "还没有父母或配偶关系，暂时无法排进世代。点人名可为 TA 添加父母（也可在弹窗里改成配偶或子女）。",
      people: canEdit ? unconnected.slice(0, 6) : undefined,
      peopleAria: "建立关系",
    });
  } else if (componentCount > 1) {
    steps.push({
      key: "branches",
      title: `连接 ${componentCount} 个家族分支`,
      body: "档案里有几支还没有连在一起。点较小分支里的人名，可为 TA 添加父母或配偶，与主支连上。",
      people: canEdit && branchReps.length > 0 ? branchReps : undefined,
      peopleAria: "连接分支",
      action: canEdit
        ? { label: "添加家庭关系", onClick: onAddRel }
        : undefined,
    });
  }
  if (missingSpouse.length > 0) {
    steps.push({
      key: "spouse",
      title: `补充 ${missingSpouse.length} 位已有子女成员的配偶`,
      body: "已有子女的人补上配偶，世系和打印版家谱会更完整。也可以先跳过。",
      people: canEdit ? missingSpouse.slice(0, 6) : undefined,
      peopleAria: "补充配偶",
    });
  }
  if (overview && total > 0 && missingBirth.length > 0) {
    steps.push({
      key: "birth",
      title: `补充 ${missingBirth.length} 位成员的出生信息`,
      body: "出生年代是排辈、核对来源最常用的线索，大概的年份也可以。",
      people: canEdit ? missingBirth.slice(0, 6) : undefined,
      peopleAria: "补充出生信息",
    });
  }
  if (overview && missingBirthPlace.length > 0) {
    steps.push({
      key: "birthPlace",
      title: `补充 ${missingBirthPlace.length} 位成员的出生地`,
      body: "有了出生年代后，补上出生地，后人核对族谱页会更容易。",
      people: canEdit ? missingBirthPlace.slice(0, 6) : undefined,
      peopleAria: "补充出生地",
    });
  }
  if (overview && missingDeath.length > 0) {
    steps.push({
      key: "death",
      title: `补充 ${missingDeath.length} 位已故成员的去世信息`,
      body: "标为已故后，补上大概的卒年，后人查阅和排谱会清楚很多。",
      people: canEdit ? missingDeath.slice(0, 6) : undefined,
      peopleAria: "补充去世信息",
    });
  } else if (overview && missingBurial.length > 0) {
    steps.push({
      key: "burial",
      title: `补充 ${missingBurial.length} 位已故成员的安葬地`,
      body: "安葬地是扫墓与核对族谱页的重要线索，记得不清楚也可以先写大概位置。",
      people: canEdit ? missingBurial.slice(0, 6) : undefined,
      peopleAria: "补充安葬地",
    });
  }
  if (overview && total > 0 && missingAncestral.length > 0) {
    steps.push({
      key: "ancestral",
      title: `补充 ${missingAncestral.length} 位成员的祖籍`,
      body: "祖籍是认亲、核对旧谱最常用的线索，写到县或村一级就可以。",
      people: canEdit ? missingAncestral.slice(0, 6) : undefined,
      peopleAria: "补充祖籍",
    });
  }
  if (overview && missingGenerationWord.length > 0) {
    steps.push({
      key: "generationWord",
      title: `补充 ${missingGenerationWord.length} 位成员的字辈`,
      body: "有了世代后，补上字辈，世系标题与打印版家谱会按辈分更清楚。同辈常用同一个字。",
      people: canEdit ? missingGenerationWord.slice(0, 6) : undefined,
      peopleAria: "补充字辈",
    });
  }
  if (overview && missingBirthOrder.length > 0) {
    steps.push({
      key: "birthOrder",
      title: `补充 ${missingBirthOrder.length} 位兄弟姐妹的排行`,
      body: "同一父母下有多位子女时，补上长/次/三…，人物页与打印版的子女顺序会更清楚。",
      people: canEdit ? missingBirthOrder.slice(0, 6) : undefined,
      peopleAria: "补充排行",
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
            label="已确认资料"
            value={overview ? `${acceptedTotal} 条` : "…"}
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
              <p className="mt-1 text-sm text-[color:var(--a-muted)]">
                成员都已连入世系，有子女的人也都补了配偶，出生、出生地、祖籍、字辈、兄弟姐妹排行与已故成员的去世信息也齐了，也没有待确认资料。可以继续补充安葬地、故事和资料来源。
              </p>
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
                            if (s.key === "connect" || s.key === "branches") {
                              onAddKin?.(p.id, "parent");
                              return;
                            }
                            if (s.key === "spouse") {
                              onAddKin?.(p.id, "spouse");
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
                                        : s.key === "generationWord"
                                          ? "GENERATION_WORD"
                                          : s.key === "birthOrder"
                                            ? "BIRTH_ORDER"
                                            : undefined
                            );
                          }}
                          className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                          aria-label={`为${p.preferredName}${s.peopleAria ?? "补充资料"}`}
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

      {overview && overview.pending.length > 0 ? (
        <section aria-labelledby="overview-pending">
          <h2
            id="overview-pending"
            className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
          >
            待确认资料
            {overview.pendingTotal > overview.pending.length
              ? `（最早的 ${overview.pending.length} 条，共 ${overview.pendingTotal} 条）`
              : `（${overview.pendingTotal}）`}
          </h2>
          <ul className="space-y-2">
            {overview.pending.map((c) => {
              const name = personName.get(c.personId) ?? "成员";
              const typeLabel = CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType;
              const statusLabel =
                CLAIM_STATUS_LABEL[c.status as keyof typeof CLAIM_STATUS_LABEL] ??
                c.status;
              return (
                <li key={c.claimId}>
                  <button
                    type="button"
                    onClick={() => onOpenRecords(c.personId)}
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
                        {canReview ? "去确认" : "查看"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
        <FamilyInvites familyId={familyId} onAuthError={onAuthError} />
      ) : null}

      {persons.length > 0 ? (
        <FamilySources familyId={familyId} onAuthError={onAuthError} />
      ) : null}

      {persons.length > 0 ? (
        <BackupSection familyId={familyId} onAuthError={onAuthError} />
      ) : null}
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
