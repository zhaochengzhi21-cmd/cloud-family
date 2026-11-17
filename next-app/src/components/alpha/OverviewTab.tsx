"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CLAIM_STATUS_LABEL, CLAIM_TYPE_UI } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";

type Person = { id: string; preferredName: string };
type Rel = { fromPersonId: string; toPersonId: string };

type Overview = Awaited<ReturnType<typeof v1api.getOverview>>["overview"];

const NAME_PREVIEW = 3;

function previewNames(names: string[]): string {
  if (names.length <= NAME_PREVIEW) return names.join("、");
  return `${names.slice(0, NAME_PREVIEW).join("、")} 等 ${names.length} 位`;
}

export function OverviewTab({
  familyId,
  persons,
  relationships,
  componentCount,
  dataVersion,
  canEdit,
  canReview,
  onAddPerson,
  onAddRel,
  onOpenRecords,
  onAuthError,
}: {
  familyId: string;
  persons: Person[];
  relationships: Rel[];
  componentCount: number;
  /** Bumps whenever the workspace reloads so the summary stays in sync. */
  dataVersion: number;
  canEdit: boolean;
  canReview: boolean;
  onAddPerson: () => void;
  onAddRel: () => void;
  onOpenRecords: (personId: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await v1api.getOverview(familyId);
      setOverview(res.overview);
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

  const missingBirth = useMemo(() => {
    if (!overview) return [];
    return sortedPersons.filter(
      (p) => !overview.personStats[p.id]?.claimTypes.includes("BIRTH_DATE")
    );
  }, [overview, sortedPersons]);

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
      body: `${previewNames(unconnected.map((p) => p.preferredName))} 还没有父母或配偶关系，暂时无法排进世代。`,
      action: canEdit
        ? { label: "添加家庭关系", onClick: onAddRel }
        : undefined,
    });
  } else if (componentCount > 1) {
    steps.push({
      key: "branches",
      title: `连接 ${componentCount} 个家族分支`,
      body: "档案里有几支还没有连在一起，补上一条关系就能合成一棵树。",
      action: canEdit
        ? { label: "添加家庭关系", onClick: onAddRel }
        : undefined,
    });
  }
  if (overview && total > 0 && missingBirth.length > 0) {
    steps.push({
      key: "birth",
      title: `补充 ${missingBirth.length} 位成员的出生信息`,
      body: "出生年代是排辈、核对来源最常用的线索，大概的年份也可以。",
      people: canEdit ? missingBirth.slice(0, 6) : undefined,
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
                成员都已连入世系、都有出生信息，也没有待确认资料。可以继续为每个人补充祖籍、安葬地和资料来源。
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
                          onClick={() => onOpenRecords(p.id)}
                          className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                          aria-label={`为${p.preferredName}补充出生信息`}
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
    </div>
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
