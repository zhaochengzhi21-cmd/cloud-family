"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  CLAIM_STATUS_LABEL,
  CLAIM_TYPE_UI,
  EVIDENCE_TYPE_UI,
  ERROR_COPY,
  GENDER_LABEL,
  LIVING_STATUS_LABEL,
  PRODUCT,
  ROLE_LABEL,
  generationLabel,
} from "@/v1/ui/copy";
import {
  userMessageForApiError,
  v1api,
  V1ApiError,
} from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";
import { MEDIA_MAX_BYTES } from "@/v1/domain/media/types";

type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

type GraphPerson = {
  id: string;
  preferredName: string;
  gender: string;
  livingStatus: string;
  revisionNo: number;
};

type GraphRel = {
  id: string;
  type: string;
  fromPersonId: string;
  toPersonId: string;
};

type ClaimRow = {
  id: string;
  claimType: string;
  value: { text?: string };
  status: string;
};

type Tab = "members" | "lineage" | "records";

const ALLOWED_EXT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".mov",
];

function mimeFromFile(file: File): string | null {
  if (file.type && Object.keys(MEDIA_MAX_BYTES).includes(file.type)) {
    return file.type;
  }
  const n = file.name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  return null;
}

export function FamilyWorkspace({
  familyId,
  initialRole,
}: {
  familyId: string;
  initialRole?: Role;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const tabReady = useRef(false);
  const [familyName, setFamilyName] = useState("");
  const [surname, setSurname] = useState<string | null>(null);
  const [familyVersion, setFamilyVersion] = useState(1);
  const [role, setRole] = useState<Role>(initialRole ?? "VIEWER");
  const [persons, setPersons] = useState<GraphPerson[]>([]);
  const [relationships, setRelationships] = useState<GraphRel[]>([]);
  const [generationByPerson, setGenerationByPerson] = useState<
    Record<string, number>
  >({});
  const [componentCount, setComponentCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [lineageFocusId, setLineageFocusId] = useState<string | null>(null);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddRel, setShowAddRel] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [relFocusPersonId, setRelFocusPersonId] = useState<string | null>(null);

  const canEdit = role === "OWNER" || role === "ADMIN" || role === "EDITOR";
  const canReview = role === "OWNER" || role === "ADMIN";

  const personMap = useMemo(() => {
    const m = new Map<string, GraphPerson>();
    for (const p of persons) m.set(p.id, p);
    return m;
  }, [persons]);

  const load = useCallback(async () => {
    setError("");
    const attempt = async () => {
      const [fam, list, graph] = await Promise.all([
        v1api.getFamily(familyId),
        v1api.listFamilies(),
        v1api.getGraph(familyId),
      ]);
      setFamilyName(fam.family.displayName);
      setSurname(fam.family.surname);
      setFamilyVersion(fam.family.currentVersionNo);
      const mine = list.families.find((f) => f.id === familyId);
      if (mine?.role) setRole(mine.role);
      setPersons(graph.graph.persons);
      setRelationships(graph.graph.relationships);
      setGenerationByPerson(graph.graph.generationByPerson);
      setComponentCount(graph.graph.componentCount);
      setError("");
    };
    try {
      await attempt();
    } catch (first) {
      if (handleAuthRedirect(first, router)) return;
      // Brief retry — Neon / edge blips after mutations should not blank the UI.
      try {
        await new Promise((r) => setTimeout(r, 400));
        await attempt();
      } catch (e) {
        if (handleAuthRedirect(e, router)) return;
        if (e instanceof V1ApiError && e.status === 404) {
          setError(ERROR_COPY.notFound);
        } else {
          setError(userMessageForApiError(e));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [familyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!familyName) return;
    const prev = document.title;
    document.title = `${familyName} · ${PRODUCT.brand}`;
    return () => {
      document.title = prev;
    };
  }, [familyName]);

  useEffect(() => {
    tabReady.current = false;
    try {
      const saved = sessionStorage.getItem(`alpha-tab:${familyId}`);
      if (saved === "members" || saved === "lineage" || saved === "records") {
        setTab(saved);
      } else {
        setTab("members");
      }
    } catch {
      setTab("members");
    }
    tabReady.current = true;
  }, [familyId]);

  useEffect(() => {
    if (!tabReady.current) return;
    try {
      sessionStorage.setItem(`alpha-tab:${familyId}`, tab);
    } catch {
      /* private mode */
    }
  }, [familyId, tab]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(""), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!lineageFocusId) return;
    const t = window.setTimeout(() => setLineageFocusId(null), 4500);
    return () => window.clearTimeout(t);
  }, [lineageFocusId]);

  const tabsOrder = useMemo(
    () =>
      [
        ["members", "成员"],
        ["lineage", "世系"],
        ["records", "资料"],
      ] as const,
    []
  );

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const idx = tabsOrder.findIndex(([id]) => id === tab);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % tabsOrder.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + tabsOrder.length) % tabsOrder.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = tabsOrder.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    setTab(tabsOrder[next][0]);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]'
    );
    buttons[next]?.focus();
  }

  if (loading) {
    return (
      <p
        className="py-16 text-center text-[color:var(--a-muted)]"
        role="status"
      >
        正在读取家族成员…
      </p>
    );
  }

  if (error && !familyName) {
    return (
      <div className="py-12 text-center">
        <p className="text-[color:var(--a-danger)]" role="alert">
          {error}
        </p>
        <button
          type="button"
          className="alpha-btn alpha-btn-secondary mt-4"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="alpha-fade-in py-2">
      <header className="mb-5">
        <Link
          href="/alpha/families"
          className="mb-3 inline-flex min-h-[40px] items-center text-sm font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-brand)]"
        >
          ← 我的家族
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="alpha-font-display text-3xl font-bold text-[color:var(--a-ink)]">
            {familyName}
          </h1>
          {canReview ? (
            <button
              type="button"
              onClick={() => setShowEditFamily(true)}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
            >
              编辑档案
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[color:var(--a-muted)]">
          {surname ? <span>{surname}</span> : null}
          <span className="alpha-chip">{persons.length} 位成员</span>
          <span className="alpha-chip">{relationships.length} 条关系</span>
          <span className="alpha-chip">{PRODUCT.privacyFamilyOnly}</span>
          <span className="alpha-chip">
            我的权限：{ROLE_LABEL[role] ?? role}
          </span>
        </div>
        {!canEdit ? (
          <p className="mt-2 text-sm text-[color:var(--a-muted)]">
            当前为只读。如需添加成员或资料，请联系家族创建者。
          </p>
        ) : !canReview ? (
          <p className="mt-2 text-sm text-[color:var(--a-muted)]">
            你可以编辑资料；确认或不采用需由创建者/管理员操作。
          </p>
        ) : null}
      </header>

      {flash ? (
        <p className="mb-3 alpha-alert alpha-alert-ok" role="status">
          {flash}
        </p>
      ) : null}
      {error && !flash ? (
        <p className="mb-3 alpha-alert alpha-alert-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="家族视图"
        className="alpha-tabs mb-5"
        onKeyDown={onTabKeyDown}
      >
        {tabsOrder.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className="alpha-tab"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <MembersTab
          persons={persons}
          generationByPerson={generationByPerson}
          canEdit={canEdit}
          onAdd={() => setShowAddPerson(true)}
          onOpen={(id) => setSelectedPersonId(id)}
        />
      ) : null}

      {tab === "lineage" ? (
        <LineageTab
          persons={persons}
          relationships={relationships}
          generationByPerson={generationByPerson}
          componentCount={componentCount}
          canEdit={canEdit}
          focusPersonId={lineageFocusId}
          onAddRel={() => {
            setRelFocusPersonId(null);
            setShowAddRel(true);
          }}
          onOpen={(id) => setSelectedPersonId(id)}
          personMap={personMap}
        />
      ) : null}

      {tab === "records" ? (
        <RecordsTab
          familyId={familyId}
          persons={persons}
          canEdit={canEdit}
          canReview={canReview}
          role={role}
          onAuthError={(e) => handleAuthRedirect(e, router)}
          onOpenPerson={(id) => setSelectedPersonId(id)}
          setFlash={setFlash}
          setError={setError}
        />
      ) : null}

      {showEditFamily ? (
        <EditFamilyModal
          familyId={familyId}
          displayName={familyName}
          surname={surname}
          expectedVersion={familyVersion}
          onClose={() => setShowEditFamily(false)}
          onDone={async () => {
            setShowEditFamily(false);
            setError("");
            setFlash("已更新家族档案");
            await load();
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}

      {showAddPerson ? (
        <AddPersonModal
          familyId={familyId}
          existingNames={persons.map((p) => p.preferredName)}
          onClose={() => setShowAddPerson(false)}
          onDone={async () => {
            setShowAddPerson(false);
            setError("");
            setFlash("已添加家族成员");
            await load();
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}

      {showAddRel ? (
        <AddRelationshipModal
          familyId={familyId}
          persons={persons}
          focusPersonId={relFocusPersonId}
          onClose={() => {
            setShowAddRel(false);
            setRelFocusPersonId(null);
          }}
          onDone={async () => {
            setShowAddRel(false);
            setRelFocusPersonId(null);
            setError("");
            setFlash("已添加家庭关系");
            await load();
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}

      {selectedPersonId && personMap.get(selectedPersonId) ? (
        <PersonDrawer
          familyId={familyId}
          person={personMap.get(selectedPersonId)!}
          generation={generationByPerson[selectedPersonId]}
          relationships={relationships}
          personMap={personMap}
          canEdit={canEdit}
          canReview={canReview}
          onClose={() => setSelectedPersonId(null)}
          onChanged={async () => {
            await load();
          }}
          onRequestAddRel={() => {
            const pid = selectedPersonId;
            setSelectedPersonId(null);
            setTab("lineage");
            setRelFocusPersonId(pid);
            setShowAddRel(true);
          }}
          onShowInLineage={() => {
            const pid = selectedPersonId;
            setSelectedPersonId(null);
            setTab("lineage");
            setLineageFocusId(pid);
          }}
          onOpenPerson={(id) => setSelectedPersonId(id)}
          onDeleted={async () => {
            setSelectedPersonId(null);
            setError("");
            setFlash("已移除该成员");
            await load();
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}
    </div>
  );
}

function MembersTab({
  persons,
  generationByPerson,
  canEdit,
  onAdd,
  onOpen,
}: {
  persons: GraphPerson[];
  generationByPerson: Record<string, number>;
  canEdit: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [livingFilter, setLivingFilter] = useState<
    "ALL" | "LIVING" | "DECEASED" | "UNKNOWN"
  >("ALL");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return persons
      .filter((p) => {
        if (livingFilter !== "ALL" && p.livingStatus !== livingFilter) {
          return false;
        }
        if (!q) return true;
        return p.preferredName.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) =>
        a.preferredName.localeCompare(b.preferredName, "zh-CN")
      );
  }, [persons, query, livingFilter]);

  if (persons.length === 0) {
    return (
      <div className="alpha-panel border-dashed px-5 py-12 text-center">
        <p className="alpha-font-display text-xl font-bold text-[color:var(--a-ink)]">
          还没有家族成员
        </p>
        <p className="mt-2 text-sm text-[color:var(--a-muted)]">
          先添加你熟悉的一两位家人即可，资料以后可以慢慢补。
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="alpha-btn alpha-btn-primary mt-6"
          >
            添加成员
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {canEdit && persons.length === 1 ? (
        <p className="mb-3 text-sm text-[color:var(--a-muted)]">
          再添加一位家人后，可在「世系」里建立父母或配偶关系。
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="alpha-btn alpha-btn-secondary !min-h-[44px] !text-sm"
          >
            + 添加成员
          </button>
        ) : null}
        {persons.length >= 3 ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按姓名筛选"
            aria-label="按姓名筛选成员"
            className="alpha-input min-w-[10rem] flex-1 !min-h-[44px]"
          />
        ) : null}
      </div>
      {persons.length >= 3 ? (
        <div
          className="mb-3 flex flex-wrap gap-2"
          role="group"
          aria-label="按在世状态筛选"
        >
          {(
            [
              ["ALL", "全部"],
              ["LIVING", "在世"],
              ["DECEASED", "已故"],
              ["UNKNOWN", "不确定"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={livingFilter === id}
              onClick={() => setLivingFilter(id)}
              className={`alpha-btn !min-h-[36px] !px-3 !text-xs ${
                livingFilter === id
                  ? "alpha-btn-primary"
                  : "alpha-btn-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[color:var(--a-muted)]">
            {query.trim()
              ? `没有匹配「${query.trim()}」的成员`
              : "没有符合当前筛选的成员"}
          </p>
          {query.trim() || livingFilter !== "ALL" ? (
            <button
              type="button"
              className="alpha-btn alpha-btn-secondary mt-4 !min-h-[40px] !text-sm"
              onClick={() => {
                setQuery("");
                setLivingFilter("ALL");
              }}
            >
              清除筛选
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="alpha-panel alpha-panel-interactive flex w-full min-h-[60px] items-center justify-between px-4 text-left"
              >
                <div>
                  <p className="font-bold text-[color:var(--a-ink)]">
                    {p.preferredName}
                  </p>
                  <p className="text-sm text-[color:var(--a-muted)]">
                    {[
                      generationByPerson[p.id]
                        ? generationLabel(generationByPerson[p.id])
                        : null,
                      LIVING_STATUS_LABEL[
                        p.livingStatus as keyof typeof LIVING_STATUS_LABEL
                      ] ?? p.livingStatus,
                      p.gender !== "UNKNOWN"
                        ? GENDER_LABEL[p.gender as keyof typeof GENDER_LABEL] ??
                          ""
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[color:var(--a-brand)]">
                  查看
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineageTab({
  persons,
  relationships,
  generationByPerson,
  componentCount,
  canEdit,
  focusPersonId,
  onAddRel,
  onOpen,
  personMap,
}: {
  persons: GraphPerson[];
  relationships: GraphRel[];
  generationByPerson: Record<string, number>;
  componentCount: number;
  canEdit: boolean;
  focusPersonId?: string | null;
  onAddRel: () => void;
  onOpen: (id: string) => void;
  personMap: Map<string, GraphPerson>;
}) {
  const spouses = useMemo(
    () => relationships.filter((r) => r.type === "SPOUSE"),
    [relationships]
  );
  const parentRels = useMemo(
    () =>
      relationships.filter((r) =>
        ["BIOLOGICAL_PARENT", "ADOPTIVE_PARENT", "STEP_PARENT"].includes(r.type)
      ),
    [relationships]
  );

  /** Per generation: clusters of 1–2 people (spouse pairs kept adjacent). */
  const byGen = useMemo(() => {
    const map = new Map<number, GraphPerson[]>();
    for (const p of persons) {
      const g = generationByPerson[p.id] ?? 1;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    const spouseOther = (id: string, pool: Set<string>) => {
      for (const r of spouses) {
        const other =
          r.fromPersonId === id
            ? r.toPersonId
            : r.toPersonId === id
              ? r.fromPersonId
              : null;
        if (other && pool.has(other)) return other;
      }
      return null;
    };
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([gen, list]) => {
        const sorted = list
          .slice()
          .sort((a, b) =>
            a.preferredName.localeCompare(b.preferredName, "zh-CN")
          );
        const remaining = new Set(sorted.map((p) => p.id));
        const byId = new Map(sorted.map((p) => [p.id, p]));
        const clusters: GraphPerson[][] = [];
        for (const p of sorted) {
          if (!remaining.has(p.id)) continue;
          remaining.delete(p.id);
          const oid = spouseOther(p.id, remaining);
          if (oid) {
            remaining.delete(oid);
            clusters.push([p, byId.get(oid)!]);
          } else {
            clusters.push([p]);
          }
        }
        return [gen, clusters] as const;
      });
  }, [persons, generationByPerson, spouses]);

  const parentsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of parentRels) {
      // from=parent, to=child
      const list = m.get(r.toPersonId) ?? [];
      const name = personMap.get(r.fromPersonId)?.preferredName;
      if (name) list.push(name);
      m.set(r.toPersonId, list);
    }
    return m;
  }, [parentRels, personMap]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of parentRels) {
      // from=parent, to=child
      const list = m.get(r.fromPersonId) ?? [];
      const name = personMap.get(r.toPersonId)?.preferredName;
      if (name && !list.includes(name)) list.push(name);
      m.set(r.fromPersonId, list);
    }
    return m;
  }, [parentRels, personMap]);

  useEffect(() => {
    if (!focusPersonId) return;
    const el = document.querySelector(
      `[data-lineage-person="${focusPersonId}"]`
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  }, [focusPersonId, byGen]);

  return (
    <div>
      {canEdit ? (
        <button
          type="button"
          onClick={onAddRel}
          className="alpha-btn alpha-btn-secondary mb-3 !min-h-[44px] !text-sm"
        >
          + 添加家庭关系
        </button>
      ) : null}

      {persons.length >= 2 && relationships.length === 0 ? (
        <p className="mb-3 rounded-xl bg-[color:var(--a-brand-soft)]/50 px-3 py-2 text-sm text-[color:var(--a-brand)]">
          已有成员，但还没有家庭关系。添加父母或配偶关系后，会按世代分层显示。
        </p>
      ) : null}

      {componentCount > 1 ? (
        <p className="mb-3 text-sm text-[color:var(--a-muted)]">
          当前档案中有 {componentCount} 个尚未连接的家族分支。
        </p>
      ) : null}

      {byGen.length === 0 ? (
        <p className="alpha-panel border-dashed px-4 py-10 text-center text-[color:var(--a-muted)]">
          添加成员并建立关系后，这里会按世代展示。
        </p>
      ) : (
        <div className="alpha-lineage-rail space-y-2">
          {byGen.map(([gen, clusters], idx) => {
            const genCount = clusters.reduce((n, c) => n + c.length, 0);
            return (
            <div key={gen}>
              {idx > 0 ? (
                <p
                  className="mb-2 pl-1 text-xs font-semibold tracking-wide text-[color:var(--a-brand)]"
                  aria-hidden
                >
                  ↓ 下一代
                </p>
              ) : null}
              <section className="mb-4">
                <h3 className="mb-2 text-sm font-bold tracking-wide text-[color:var(--a-brand)]">
                  {generationLabel(gen)}
                  <span className="ml-2 font-normal text-[color:var(--a-muted)]">
                    {genCount} 人
                  </span>
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {clusters.map((cluster) => {
                    const isCouple = cluster.length === 2;
                    return (
                      <li
                        key={cluster.map((p) => p.id).join("-")}
                        className={
                          isCouple
                            ? "flex items-stretch gap-1 rounded-2xl border border-[color:var(--a-brand-line)]/40 bg-[color:var(--a-surface)]/60 p-1"
                            : undefined
                        }
                      >
                        {cluster.map((p, pi) => {
                          const parentNames = parentsOf.get(p.id) ?? [];
                          const childNames = childrenOf.get(p.id) ?? [];
                          const showSpouseLine =
                            !isCouple &&
                            spouses.some(
                              (r) =>
                                r.fromPersonId === p.id ||
                                r.toPersonId === p.id
                            );
                          const spouseNames = showSpouseLine
                            ? spouses
                                .filter(
                                  (r) =>
                                    r.fromPersonId === p.id ||
                                    r.toPersonId === p.id
                                )
                                .map((r) => {
                                  const oid =
                                    r.fromPersonId === p.id
                                      ? r.toPersonId
                                      : r.fromPersonId;
                                  return personMap.get(oid)?.preferredName;
                                })
                                .filter(Boolean)
                            : [];
                          const hasMeta =
                            parentNames.length > 0 ||
                            spouseNames.length > 0 ||
                            childNames.length > 0;
                          return (
                            <div key={p.id} className="flex items-center gap-1">
                              {isCouple && pi === 1 ? (
                                <span
                                  className="px-0.5 text-sm font-semibold text-[color:var(--a-brand)]"
                                  aria-hidden
                                >
                                  ·
                                </span>
                              ) : null}
                              <button
                                type="button"
                                data-lineage-person={p.id}
                                onClick={() => onOpen(p.id)}
                                aria-label={p.preferredName}
                                className={`alpha-panel alpha-panel-interactive min-w-[6.75rem] px-2.5 py-1.5 text-left ${
                                  focusPersonId === p.id
                                    ? "ring-2 ring-[color:var(--a-brand)] ring-offset-1"
                                    : ""
                                }`}
                              >
                                <p className="font-bold leading-snug text-[color:var(--a-ink)]">
                                  {p.preferredName}
                                </p>
                                {parentNames.length ? (
                                  <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--a-muted)]">
                                    父母：{parentNames.join("、")}
                                  </p>
                                ) : null}
                                {spouseNames.length ? (
                                  <p className="text-[11px] leading-snug text-[color:var(--a-muted)]">
                                    配偶：{spouseNames.join("、")}
                                  </p>
                                ) : null}
                                {childNames.length ? (
                                  <p className="text-[11px] leading-snug text-[color:var(--a-muted)]">
                                    子女：{childNames.join("、")}
                                  </p>
                                ) : null}
                                {!hasMeta && !isCouple ? (
                                  <p className="text-[11px] text-[color:var(--a-brand)]">
                                    查看详情
                                  </p>
                                ) : null}
                              </button>
                            </div>
                          );
                        })}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordsTab({
  familyId,
  persons,
  canEdit,
  canReview,
  role,
  onAuthError,
  onOpenPerson,
  setFlash,
  setError,
}: {
  familyId: string;
  persons: GraphPerson[];
  canEdit: boolean;
  canReview: boolean;
  role: Role;
  onAuthError: (e: unknown) => boolean;
  onOpenPerson: (id: string) => void;
  setFlash: (s: string) => void;
  setError: (s: string) => void;
}) {
  const [personId, setPersonId] = useState(persons[0]?.id ?? "");
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const sortedPersons = useMemo(
    () =>
      persons
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons]
  );

  const loadClaims = useCallback(async () => {
    if (!personId) {
      setClaims([]);
      return;
    }
    setLoading(true);
    try {
      const res = await v1api.listPersonClaims(familyId, personId);
      setClaims(res.claims);
    } catch (e) {
      if (onAuthError(e)) return;
      setError(userMessageForApiError(e));
    } finally {
      setLoading(false);
    }
  }, [familyId, personId, onAuthError, setError]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  useEffect(() => {
    if (!personId && persons[0]) setPersonId(persons[0].id);
  }, [persons, personId]);

  useEffect(() => {
    if (!personId) return;
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [personId]);

  const active = claims.filter((c) => c.status !== "REJECTED");
  const rejected = claims.filter((c) => c.status === "REJECTED");

  const grouped = useMemo(() => {
    const m = new Map<string, ClaimRow[]>();
    for (const c of active) {
      if (!m.has(c.claimType)) m.set(c.claimType, []);
      m.get(c.claimType)!.push(c);
    }
    return m;
  }, [active]);

  if (persons.length === 0) {
    return (
      <div className="alpha-panel border-dashed px-5 py-12 text-center">
        <p className="alpha-font-display text-xl font-bold text-[color:var(--a-ink)]">
          还没有可记录的成员
        </p>
        <p className="mt-2 text-sm text-[color:var(--a-muted)]">
          先在「成员」里添加家人，再回来写下我们知道的事。
        </p>
      </div>
    );
  }

  return (
    <div ref={topRef}>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--a-muted)]">
        关于这个家族，我们知道些什么，以及这些信息从哪里来。
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="records-person" className="alpha-label">
            选择成员
          </label>
          <select
            id="records-person"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="alpha-input"
          >
            {sortedPersons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferredName}
              </option>
            ))}
          </select>
        </div>
        {personId ? (
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary !min-h-[44px] !text-sm"
            onClick={() => onOpenPerson(personId)}
          >
            打开此人
          </button>
        ) : null}
      </div>

      {canEdit && personId ? (
        <AddClaimForm
          familyId={familyId}
          personId={personId}
          canReview={canReview}
          compact
          onAuthError={onAuthError}
          onDone={async () => {
            setFlash("已添加人物资料");
            await loadClaims();
          }}
          onError={setError}
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-[color:var(--a-muted)]" role="status">
          正在读取人物资料…
        </p>
      ) : null}

      {[...grouped.entries()].map(([type, rows]) => {
        const conflicted = rows.filter((r) => r.status === "CONFLICTED");
        const label = CLAIM_TYPE_UI[type]?.label ?? type;
        return (
          <section
            key={type}
            className="mb-4 rounded-2xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] p-4"
          >
            <h3 className="font-bold text-[color:var(--a-ink)]">{label}</h3>
            {conflicted.length >= 2 ? (
              <div className="mt-2 rounded-xl bg-[color:var(--a-warn-soft)] px-3 py-2 ring-1 ring-[color:var(--a-brand-line)]">
                <p className="font-semibold text-[color:var(--a-brand)]">存在不同说法</p>
                <p className="mt-1 text-sm text-[color:var(--a-muted)]">
                  目前资料中记录不一致，先保留两种说法，之后可以继续补充来源。
                </p>
              </div>
            ) : null}
            <ul className="mt-3 space-y-3">
              {rows.map((c) => (
                <ClaimCard
                  key={c.id}
                  familyId={familyId}
                  claim={c}
                  canEdit={canEdit}
                  canReview={canReview}
                  onAuthError={onAuthError}
                  onChanged={loadClaims}
                  onError={setError}
                  onFlash={setFlash}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {rejected.length > 0 ? (
        <details className="mt-4 rounded-xl border border-[color:var(--a-brand-line)]/25 bg-[color:var(--a-surface)] p-3">
          <summary className="cursor-pointer font-semibold text-[color:var(--a-muted)]">
            查看不采用的记录（{rejected.length}）
          </summary>
          <ul className="mt-2 space-y-2 text-sm text-[color:var(--a-muted)]">
            {rejected.map((c) => (
              <li key={c.id}>
                {CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType}：
                {c.value?.text ?? "—"}（不采用）
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!loading && active.length === 0 ? (
        <div className="alpha-panel border-dashed px-4 py-8 text-center">
          <p className="font-semibold text-[color:var(--a-ink)]">
            {role === "VIEWER" ? "暂无人物资料" : "还没有人物资料"}
          </p>
          <p className="mt-1 text-sm text-[color:var(--a-muted)]">
            {role === "VIEWER"
              ? "有编辑权限的家人补充后，会显示在这里。"
              : "可以从出生信息、祖籍等开始记录，以后再补来源。"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AddClaimForm({
  familyId,
  personId,
  canReview,
  onDone,
  onError,
  onAuthError,
  compact = false,
}: {
  familyId: string;
  personId: string;
  canReview: boolean;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
  /** On mobile-first surfaces, start collapsed to reduce density. */
  compact?: boolean;
}) {
  const [claimType, setClaimType] = useState("BIRTH_DATE");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);
  const [localError, setLocalError] = useState("");
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalError("");
    setText("");
    setClaimType("BIRTH_DATE");
    if (compact) setOpen(false);
  }, [personId, compact]);

  useEffect(() => {
    if (open) textRef.current?.focus();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      await v1api.createClaim(familyId, {
        subjectId: personId,
        claimType,
        value: { text: text.trim() },
      });
      setText("");
      if (compact) setOpen(false);
      await onDone();
    } catch (err) {
      if (onAuthError(err)) return;
      const msg = userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => {
          setLocalError("");
          setOpen(true);
        }}
        className="alpha-btn alpha-btn-secondary mb-4 w-full !min-h-[44px] !text-sm"
      >
        + 添加人物资料
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="alpha-claim-composer alpha-panel mb-5 space-y-3 p-4"
      data-collapsed={compact && !open ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-[color:var(--a-ink)]">添加人物资料</p>
        {compact ? (
          <button
            type="button"
            className="text-sm font-semibold text-[color:var(--a-muted)]"
            onClick={() => setOpen(false)}
          >
            收起
          </button>
        ) : null}
      </div>
      {localError ? (
        <p className="alpha-alert alpha-alert-error" role="alert">
          {localError}
        </p>
      ) : null}
      <div className="alpha-claim-composer-body space-y-3">
        <div>
          <label htmlFor="claim-type" className="alpha-label">
            资料类型
          </label>
          <select
            id="claim-type"
            value={claimType}
            onChange={(e) => setClaimType(e.target.value)}
            className="alpha-input"
          >
            {Object.entries(CLAIM_TYPE_UI).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="claim-text" className="alpha-label">
            {CLAIM_TYPE_UI[claimType]?.label ?? "内容"}
          </label>
          <input
            ref={textRef}
            id="claim-text"
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={CLAIM_TYPE_UI[claimType]?.placeholder}
            className="alpha-input"
          />
        </div>
        <p className="text-xs text-[color:var(--a-muted)]">
          保存后为「待确认」
          {canReview ? "，可继续添加资料来源后再确认。" : "。"}
        </p>
        <button
          type="submit"
          disabled={busy}
          className="alpha-btn alpha-btn-primary !min-h-[44px]"
        >
          {busy ? "保存中…" : "保存资料"}
        </button>
      </div>
    </form>
  );
}

function ClaimCard({
  familyId,
  claim,
  canEdit,
  canReview,
  onChanged,
  onError,
  onFlash,
  onAuthError,
}: {
  familyId: string;
  claim: ClaimRow;
  canEdit: boolean;
  canReview: boolean;
  onChanged: () => Promise<void>;
  onError: (s: string) => void;
  onFlash: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [bundle, setBundle] = useState<Awaited<
    ReturnType<typeof v1api.getClaim>
  > | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(
    null
  );
  const [removingBusy, setRemovingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await v1api.getClaim(familyId, claim.id);
        if (!cancelled) setBundle(b);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, claim.id]);

  const statusLabel =
    CLAIM_STATUS_LABEL[claim.status as keyof typeof CLAIM_STATUS_LABEL] ??
    claim.status;
  const statusChip =
    claim.status === "ACCEPTED"
      ? "alpha-chip alpha-chip-accepted"
      : claim.status === "CONFLICTED"
        ? "alpha-chip alpha-chip-conflicted"
        : claim.status === "REJECTED"
          ? "alpha-chip alpha-chip-rejected"
          : "alpha-chip alpha-chip-proposed";

  return (
    <li className="alpha-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-[color:var(--a-ink)]">
            {claim.value?.text ?? "—"}
          </p>
          <p className="mt-1">
            <span className={statusChip}>{statusLabel}</span>
          </p>
        </div>
        {canReview && claim.status === "PROPOSED" ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="alpha-btn alpha-btn-primary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                try {
                  await v1api.acceptClaim(familyId, claim.id);
                  onFlash("已确认这条资料");
                  await onChanged();
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                }
              }}
            >
              确认这条资料
            </button>
            <button
              type="button"
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                try {
                  await v1api.rejectClaim(familyId, claim.id);
                  onFlash("已标记为不采用");
                  await onChanged();
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                }
              }}
            >
              不采用
            </button>
          </div>
        ) : null}
        {canReview && claim.status === "CONFLICTED" ? (
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
            onClick={async () => {
              try {
                await v1api.rejectClaim(familyId, claim.id);
                onFlash("已处理不同说法");
                await onChanged();
              } catch (e) {
                if (onAuthError(e)) return;
                onError(userMessageForApiError(e));
              }
            }}
          >
            不采用
          </button>
        ) : null}
      </div>

      {bundle?.evidenceLinks?.length ? (
        <ul className="mt-3 space-y-2 border-t border-[color:var(--a-brand-line)] pt-2 text-sm">
          {bundle.evidenceLinks.map((l) => (
            <li
              key={l.evidence.id}
              className="flex flex-wrap items-start justify-between gap-2 text-[color:var(--a-muted)]"
            >
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-[color:var(--a-ink)]">
                  {EVIDENCE_TYPE_UI[l.evidence.evidenceType] ?? "来源"}
                </span>
                {l.evidence.title ? ` · ${l.evidence.title}` : ""}
                {l.evidence.sourceLocator
                  ? ` · ${l.evidence.sourceLocator}`
                  : ""}
                {l.evidence.mediaObjectId ? (
                  <MediaViewButton
                    familyId={familyId}
                    mediaId={l.evidence.mediaObjectId}
                    onAuthError={onAuthError}
                    onError={onError}
                  />
                ) : null}
              </div>
              {canReview ? (
                removingEvidenceId === l.evidence.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[color:var(--a-danger)]">
                      确认移除？
                    </span>
                    <button
                      type="button"
                      className="font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)]"
                      disabled={removingBusy}
                      onClick={() => setRemovingEvidenceId(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-[color:var(--a-danger)] hover:underline"
                      disabled={removingBusy}
                      onClick={async () => {
                        setRemovingBusy(true);
                        try {
                          await v1api.deleteEvidence(
                            familyId,
                            l.evidence.id
                          );
                          onFlash("已移除资料来源");
                          setRemovingEvidenceId(null);
                          const b = await v1api.getClaim(familyId, claim.id);
                          setBundle(b);
                          await onChanged();
                        } catch (e) {
                          if (onAuthError(e)) return;
                          onError(userMessageForApiError(e));
                          setRemovingEvidenceId(null);
                        } finally {
                          setRemovingBusy(false);
                        }
                      }}
                    >
                      {removingBusy ? "移除中…" : "确认移除"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-danger)]"
                    onClick={() => setRemovingEvidenceId(l.evidence.id)}
                  >
                    移除来源
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-[color:var(--a-brand)]"
          onClick={() => setShowEvidence(true)}
        >
          添加资料来源
        </button>
      ) : null}

      {showEvidence ? (
        <AddEvidenceForm
          familyId={familyId}
          claimId={claim.id}
          onClose={() => setShowEvidence(false)}
          onDone={async () => {
            setShowEvidence(false);
            onFlash("已添加资料来源");
            const b = await v1api.getClaim(familyId, claim.id);
            setBundle(b);
            await onChanged();
          }}
          onError={onError}
          onAuthError={onAuthError}
        />
      ) : null}
    </li>
  );
}

function MediaViewButton({
  familyId,
  mediaId,
  onAuthError,
  onError,
}: {
  familyId: string;
  mediaId: string;
  onAuthError: (e: unknown) => boolean;
  onError: (s: string) => void;
}) {
  return (
    <button
      type="button"
      className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
      onClick={async () => {
        try {
          const res = await v1api.mediaRead(familyId, mediaId);
          window.open(res.read.url, "_blank", "noopener,noreferrer");
        } catch (e) {
          if (onAuthError(e)) return;
          onError(userMessageForApiError(e));
        }
      }}
    >
      查看原始资料
    </button>
  );
}

function AddEvidenceForm({
  familyId,
  claimId,
  onClose,
  onDone,
  onError,
  onAuthError,
}: {
  familyId: string;
  claimId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [evidenceType, setEvidenceType] = useState("GENEALOGY_PAGE");
  const [title, setTitle] = useState("");
  const [sourceLocator, setSourceLocator] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const leaveWarn = useRef(false);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (leaveWarn.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  function setPhase(label: string, pct: number) {
    setUploadState(label);
    setUploadPct(pct);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    leaveWarn.current = true;
    let phase = "";
    try {
      let mediaObjectId: string | null = null;
      if (file) {
        const mime = mimeFromFile(file);
        if (!mime) {
          const msg = "不支持的文件类型。请选择图片、PDF、音频或视频。";
          setLocalError(msg);
          onError(msg);
          return;
        }
        const max = MEDIA_MAX_BYTES[mime] ?? 0;
        if (file.size > max) {
          const mb = Math.round(max / (1024 * 1024));
          const msg = mime.startsWith("image/")
            ? `图片最大 ${mb} MB。`
            : mime === "application/pdf"
              ? `PDF 最大 ${mb} MB。`
              : `该类型文件最大 ${mb} MB。`;
          setLocalError(msg);
          onError(msg);
          return;
        }
        phase = "准备上传";
        setPhase(phase, 12);
        const reserved = await v1api.reserveMedia(familyId, {
          originalFilename: file.name,
          mimeType: mime,
          byteSize: file.size,
        });
        phase = "正在上传文件…";
        setPhase(phase, 45);
        const handleUploadUrl = reserved.upload.handleUploadUrl.startsWith(
          "http"
        )
          ? reserved.upload.handleUploadUrl
          : `${window.location.origin}${reserved.upload.handleUploadUrl}`;
        await upload(reserved.upload.pathname, file, {
          access: "private",
          handleUploadUrl,
          clientPayload: JSON.stringify({ mediaId: reserved.media.id }),
          contentType: mime,
          multipart: reserved.upload.multipartRecommended,
        });
        phase = "正在确认文件…";
        setPhase(phase, 72);
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const st = await v1api.mediaStatus(familyId, reserved.media.id);
          if (st.status === "ACTIVE") {
            mediaObjectId = reserved.media.id;
            phase = "上传完成";
            setPhase(phase, 100);
            break;
          }
          if (st.status === "FAILED") {
            throw new Error("upload failed");
          }
          // Local Preview: webhook cannot reach localhost — opt-in finalize.
          if (st.status === "PENDING_UPLOAD") {
            try {
              await v1api.mediaFinalizeLocal(familyId, reserved.media.id);
            } catch {
              /* Production 404 / object not ready — keep polling */
            }
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!mediaObjectId) {
          setPhase("上传超时", uploadPct);
          const msg = "上传超时，请稍后重试。";
          setLocalError(msg);
          onError(msg);
          return;
        }
      }

      phase = file ? "正在保存来源…" : "";
      if (phase) setPhase(phase, 92);
      const ev = await v1api.createEvidence(familyId, {
        evidenceType,
        title: title.trim() || null,
        description: description.trim() || null,
        sourceLocator: sourceLocator.trim() || null,
        mediaObjectId,
      });
      await v1api.linkEvidence(familyId, claimId, {
        evidenceId: ev.evidence.id,
        relation: "SUPPORTS",
      });
      setPhase("", 0);
      await onDone();
    } catch (err) {
      if (onAuthError(err)) return;
      setPhase(phase ? "上传失败" : "", phase ? Math.max(uploadPct, 8) : 0);
      const msg = phase
        ? "上传或保存失败，请检查文件后重试。"
        : userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      leaveWarn.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface-strong)] p-3">
      <form onSubmit={submit} className="space-y-3">
        {localError ? (
          <p className="alpha-alert alpha-alert-error" role="alert">
            {localError}
          </p>
        ) : null}
        <div>
          <label htmlFor="ev-type" className="alpha-label">
            来源类型
          </label>
          <select
            id="ev-type"
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value)}
            className="alpha-input"
          >
            {Object.entries(EVIDENCE_TYPE_UI).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ev-title" className="alpha-label">
            来源标题（可选）
          </label>
          <input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="alpha-input"
          />
        </div>
        <div>
          <label htmlFor="ev-loc" className="alpha-label">
            出处位置（可选）
          </label>
          <input
            id="ev-loc"
            value={sourceLocator}
            onChange={(e) => setSourceLocator(e.target.value)}
            placeholder="例如：第17页"
            className="alpha-input"
          />
        </div>
        <div>
          <label htmlFor="ev-desc" className="alpha-label">
            来源说明（可选）
          </label>
          <textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="alpha-input !min-h-[4.5rem] py-2"
          />
        </div>
        <div>
          <label htmlFor="ev-file" className="alpha-label">
            附件（可选）
          </label>
          <input
            id="ev-file"
            type="file"
            accept={ALLOWED_EXT.join(",")}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setLocalError("");
            }}
            className="block w-full text-sm text-[color:var(--a-muted)]"
          />
          <p className="mt-1 text-xs text-[color:var(--a-muted)]">
            支持 JPG/PNG/WEBP/PDF 与常见音视频。图片最大 20 MB。仅家族成员可见。
          </p>
          {file ? (
            <p className="mt-1 text-xs text-[color:var(--a-muted)]">
              已选择：{file.name}
              {file.size > 0
                ? `（${Math.max(1, Math.round(file.size / 1024))} KB）`
                : ""}
            </p>
          ) : null}
          {uploadState ? (
            <div className="mt-2" role="status" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--a-brand-soft)]">
                <div
                  className="h-full rounded-full bg-[color:var(--a-brand)] transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, uploadPct))}%` }}
                />
              </div>
              <p
                className={`mt-1 text-sm ${
                  uploadState.includes("失败") || uploadState.includes("超时")
                    ? "text-[color:var(--a-danger)]"
                    : "text-[color:var(--a-muted)]"
                }`}
              >
                {uploadState}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="alpha-btn alpha-btn-secondary flex-1 !min-h-[44px]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="alpha-btn alpha-btn-primary flex-1 !min-h-[44px]"
          >
            {busy
              ? uploadState && !uploadState.includes("失败")
                ? uploadState
                : "保存中…"
              : "保存来源"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditFamilyModal({
  familyId,
  displayName,
  surname,
  expectedVersion,
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  displayName: string;
  surname: string | null;
  expectedVersion: number;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const [name, setName] = useState(displayName);
  const [sur, setSur] = useState(surname ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      await v1api.patchFamily(familyId, {
        expectedVersion,
        displayName: name.trim(),
        surname: sur.trim() ? sur.trim() : null,
      });
      await onDone();
    } catch (err) {
      if (onAuth(err)) return;
      const msg = userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="编辑家族档案" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {localError ? (
          <p className="alpha-alert alpha-alert-error" role="alert">
            {localError}
          </p>
        ) : null}
        <div>
          <label htmlFor="edit-fam-name" className="alpha-label">
            家族名称 *
          </label>
          <input
            ref={firstRef}
            id="edit-fam-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="alpha-input"
          />
        </div>
        <div>
          <label htmlFor="edit-fam-surname" className="alpha-label">
            姓氏（可选）
          </label>
          <input
            id="edit-fam-surname"
            value={sur}
            onChange={(e) => setSur(e.target.value)}
            className="alpha-input"
          />
        </div>
        <p className="text-xs text-[color:var(--a-muted)]">
          可见性仍为「仅家族成员可见」。邀请家人加入的能力将在后续版本开放。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="alpha-btn alpha-btn-primary flex-1"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddPersonModal({
  familyId,
  existingNames,
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  existingNames: string[];
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const [name, setName] = useState("");
  const [living, setLiving] = useState("UNKNOWN");
  const [gender, setGender] = useState("UNKNOWN");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const duplicateName =
    trimmed.length > 0 &&
    existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      await v1api.createPerson(familyId, {
        preferredName: name.trim(),
        livingStatus: living,
        gender,
      });
      await onDone();
    } catch (err) {
      if (onAuth(err)) return;
      const msg = userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="添加成员" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {localError ? (
          <p className="alpha-alert alpha-alert-error" role="alert">
            {localError}
          </p>
        ) : null}
        <div>
          <label htmlFor="p-name" className="alpha-label">
            姓名 / 常用称呼 *
          </label>
          <input
            ref={firstRef}
            id="p-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="alpha-input"
          />
          {duplicateName ? (
            <p className="mt-1.5 text-sm text-[color:var(--a-brand)]" role="status">
              已有同名成员。若是不同的人，可继续添加并用称呼区分。
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="p-living" className="alpha-label">
            是否仍在世
          </label>
          <select
            id="p-living"
            value={living}
            onChange={(e) => setLiving(e.target.value)}
            className="alpha-input"
          >
            <option value="UNKNOWN">不确定</option>
            <option value="LIVING">在世</option>
            <option value="DECEASED">已故</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-gender" className="alpha-label">
            性别（可选）
          </label>
          <select
            id="p-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="alpha-input"
          >
            <option value="UNKNOWN">未填写</option>
            <option value="MALE">男</option>
            <option value="FEMALE">女</option>
            <option value="OTHER">其他</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="alpha-btn alpha-btn-primary flex-1"
          >
            {busy ? "添加中…" : "添加"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddRelationshipModal({
  familyId,
  persons,
  focusPersonId,
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  persons: GraphPerson[];
  focusPersonId?: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const fallbackA = persons[0]?.id ?? "";
  const fallbackB = persons[1]?.id ?? persons[0]?.id ?? "";
  const focus =
    focusPersonId && persons.some((p) => p.id === focusPersonId)
      ? focusPersonId
      : null;
  const other =
    persons.find((p) => p.id !== focus)?.id ?? fallbackB;

  const [mode, setMode] = useState<"parent" | "spouse">("parent");
  // From drawer: default focused person as child (common: add their parent).
  const [parentId, setParentId] = useState(focus ? other : fallbackA);
  const [childId, setChildId] = useState(focus ?? fallbackB);
  const [parentType, setParentType] = useState("BIOLOGICAL_PARENT");
  const [aId, setAId] = useState(focus ?? fallbackA);
  const [bId, setBId] = useState(focus ? other : fallbackB);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      if (mode === "parent") {
        if (parentId === childId) {
          setLocalError("父母与子女不能是同一人。");
          return;
        }
        await v1api.createRelationship(familyId, {
          fromPersonId: parentId,
          toPersonId: childId,
          relationshipType: parentType,
        });
      } else {
        if (aId === bId) {
          setLocalError("请选择两位不同的成员。");
          return;
        }
        await v1api.createRelationship(familyId, {
          fromPersonId: aId,
          toPersonId: bId,
          relationshipType: "SPOUSE",
        });
      }
      await onDone();
    } catch (err) {
      if (onAuth(err)) return;
      const msg = userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (persons.length < 2) {
    return (
      <ModalShell title="添加家庭关系" onClose={onClose}>
        <p className="text-sm leading-relaxed text-[color:var(--a-muted)]">
          至少需要两位成员，才能建立父母或配偶关系。请先再添加一位家人。
        </p>
        <button
          type="button"
          onClick={onClose}
          className="alpha-btn alpha-btn-primary mt-5 w-full"
        >
          知道了
        </button>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="添加家庭关系" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {focus ? (
          <p className="text-sm text-[color:var(--a-muted)]">
            正在为「
            {persons.find((p) => p.id === focus)?.preferredName ?? "成员"}
            」补充关系
          </p>
        ) : null}
        {localError ? (
          <p className="alpha-alert alpha-alert-error" role="alert">
            {localError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            className={`alpha-btn flex-1 !min-h-[40px] !text-sm ${
              mode === "parent"
                ? "alpha-btn-primary"
                : "alpha-btn-secondary"
            }`}
            onClick={() => setMode("parent")}
          >
            父母 → 子女
          </button>
          <button
            type="button"
            className={`alpha-btn flex-1 !min-h-[40px] !text-sm ${
              mode === "spouse"
                ? "alpha-btn-primary"
                : "alpha-btn-secondary"
            }`}
            onClick={() => setMode("spouse")}
          >
            配偶
          </button>
        </div>
        {mode === "parent" ? (
          <>
            <div>
              <label htmlFor="rel-parent" className="alpha-label">
                父母人物
              </label>
              <select
                id="rel-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="alpha-input"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-child" className="alpha-label">
                子女人物
              </label>
              <select
                id="rel-child"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="alpha-input"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-type" className="alpha-label">
                关系类型
              </label>
              <select
                id="rel-type"
                value={parentType}
                onChange={(e) => setParentType(e.target.value)}
                className="alpha-input"
              >
                <option value="BIOLOGICAL_PARENT">亲生</option>
                <option value="ADOPTIVE_PARENT">收养</option>
                <option value="STEP_PARENT">继亲</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor="rel-a" className="alpha-label">
                成员一
              </label>
              <select
                id="rel-a"
                value={aId}
                onChange={(e) => setAId(e.target.value)}
                className="alpha-input"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-b" className="alpha-label">
                成员二
              </label>
              <select
                id="rel-b"
                value={bId}
                onChange={(e) => setBId(e.target.value)}
                className="alpha-input"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="alpha-btn alpha-btn-primary flex-1"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function PersonDrawer({
  familyId,
  person,
  generation,
  relationships,
  personMap,
  canEdit,
  canReview,
  onClose,
  onChanged,
  onDeleted,
  onRequestAddRel,
  onShowInLineage,
  onOpenPerson,
  onError,
  onAuth,
}: {
  familyId: string;
  person: GraphPerson;
  generation?: number;
  relationships: GraphRel[];
  personMap: Map<string, GraphPerson>;
  canEdit: boolean;
  canReview: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onRequestAddRel: () => void;
  onShowInLineage: () => void;
  onOpenPerson: (id: string) => void;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(person.preferredName);
  const [living, setLiving] = useState(person.livingStatus);
  const [gender, setGender] = useState(person.gender);
  const [revision, setRevision] = useState(person.revisionNo);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmRelId, setConfirmRelId] = useState<string | null>(null);
  const [removingRel, setRemovingRel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localFlash, setLocalFlash] = useState("");
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);

  useEffect(() => {
    setName(person.preferredName);
    setLiving(person.livingStatus);
    setGender(person.gender);
    setRevision(person.revisionNo);
    setConfirmDelete(false);
    setConfirmRelId(null);
    setLocalError("");
    setLocalFlash("");
  }, [person.id, person.preferredName, person.livingStatus, person.gender, person.revisionNo]);

  useEffect(() => {
    if (!localFlash) return;
    const t = window.setTimeout(() => setLocalFlash(""), 4000);
    return () => window.clearTimeout(t);
  }, [localFlash]);

  const loadClaims = useCallback(async () => {
    setClaimsLoading(true);
    try {
      const res = await v1api.listPersonClaims(familyId, person.id);
      setClaims(res.claims);
    } catch (e) {
      if (onAuth(e)) return;
      setLocalError(userMessageForApiError(e));
    } finally {
      setClaimsLoading(false);
    }
  }, [familyId, person.id, onAuth]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmRelId) {
        setConfirmRelId(null);
        return;
      }
      if (confirmDelete) {
        setConfirmDelete(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete, confirmRelId]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const relRows = relationships
    .filter((r) => r.fromPersonId === person.id || r.toPersonId === person.id)
    .map((r) => {
      const otherId =
        r.fromPersonId === person.id ? r.toPersonId : r.fromPersonId;
      const otherName = personMap.get(otherId)?.preferredName ?? "成员";
      let kind: string;
      if (r.type === "SPOUSE") kind = "配偶";
      else if (r.fromPersonId === person.id) kind = "子女";
      else kind = "父母";
      return { id: r.id, kind, otherId, otherName };
    });

  const activeClaims = claims.filter((c) => c.status !== "REJECTED");
  const rejectedClaims = claims.filter((c) => c.status === "REJECTED");
  const grouped = useMemo(() => {
    const m = new Map<string, ClaimRow[]>();
    for (const c of activeClaims) {
      if (!m.has(c.claimType)) m.set(c.claimType, []);
      m.get(c.claimType)!.push(c);
    }
    return m;
  }, [activeClaims]);

  async function saveBasics(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setLocalError("");
    try {
      const res = await v1api.patchPerson(familyId, person.id, {
        expectedRevision: revision,
        preferredName: name.trim(),
        livingStatus: living,
        gender,
      });
      setRevision(res.person.revisionNo);
      setLiving(res.person.livingStatus);
      setGender(res.person.gender);
      setLocalFlash("已保存基本信息");
      await onChanged();
    } catch (err) {
      if (onAuth(err)) return;
      if (err instanceof V1ApiError && err.code === "PERSON_VERSION_CONFLICT") {
        setLocalError(ERROR_COPY.personConflict);
        onError(ERROR_COPY.personConflict);
        await onChanged();
      } else {
        const msg = userMessageForApiError(err);
        setLocalError(msg);
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[color:var(--a-ink)]/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-drawer-title"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (confirmDelete || confirmRelId) return;
        onClose();
      }}
    >
      <div className="alpha-drawer-panel flex h-full w-full max-w-md flex-col bg-[color:var(--a-surface-strong)] shadow-[var(--a-shadow)]">
        <div className="flex items-center justify-between border-b border-[color:var(--a-brand-line)] px-4 py-3">
          <div className="min-w-0">
            <h2
              id="person-drawer-title"
              className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]"
            >
              {person.preferredName}
            </h2>
            {generation ? (
              <p className="mt-0.5 text-sm text-[color:var(--a-muted)]">
                {generationLabel(generation)}
              </p>
            ) : null}
          </div>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg text-sm font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)]"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {localError ? (
            <p className="mb-3 alpha-alert alpha-alert-error" role="alert">
              {localError}
            </p>
          ) : null}
          {localFlash ? (
            <p className="mb-3 alpha-alert alpha-alert-ok" role="status">
              {localFlash}
            </p>
          ) : null}
          {!canEdit ? (
            <p className="text-sm text-[color:var(--a-muted)]">
              {LIVING_STATUS_LABEL[
                living as keyof typeof LIVING_STATUS_LABEL
              ] ?? living}
              {gender !== "UNKNOWN"
                ? ` · ${GENDER_LABEL[gender as keyof typeof GENDER_LABEL] ?? ""}`
                : ""}
            </p>
          ) : (
            <form
              onSubmit={saveBasics}
              className="mt-4 space-y-3"
              data-revision={revision}
            >
              <div>
                <label htmlFor="edit-name" className="alpha-label">
                  姓名
                </label>
                <input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="alpha-input"
                />
              </div>
              <div>
                <label htmlFor="edit-living" className="alpha-label">
                  是否仍在世
                </label>
                <select
                  id="edit-living"
                  value={living}
                  onChange={(e) => setLiving(e.target.value)}
                  className="alpha-input"
                >
                  <option value="UNKNOWN">不确定</option>
                  <option value="LIVING">在世</option>
                  <option value="DECEASED">已故</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-gender" className="alpha-label">
                  性别（可选）
                </label>
                <select
                  id="edit-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="alpha-input"
                >
                  <option value="UNKNOWN">未填写</option>
                  <option value="MALE">男</option>
                  <option value="FEMALE">女</option>
                  <option value="OTHER">其他</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="alpha-btn alpha-btn-primary w-full !min-h-[44px] !text-sm"
              >
                {busy ? "保存中…" : "保存基本信息"}
              </button>
            </form>
          )}
          <h3 className="mt-6 font-bold text-[color:var(--a-ink)]">家庭关系</h3>
          {relRows.length ? (
            <ul className="mt-2 space-y-2 text-sm text-[color:var(--a-muted)]">
              {relRows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {row.kind}：
                    {personMap.has(row.otherId) ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        onClick={() => {
                          setConfirmRelId(null);
                          onOpenPerson(row.otherId);
                        }}
                      >
                        {row.otherName}
                      </button>
                    ) : (
                      row.otherName
                    )}
                  </span>
                  {canEdit ? (
                    confirmRelId === row.id ? (
                      <span className="flex gap-2">
                        <button
                          type="button"
                          className="text-xs font-semibold text-[color:var(--a-muted)]"
                          disabled={removingRel}
                          onClick={() => setConfirmRelId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[color:var(--a-danger)]"
                          disabled={removingRel}
                          onClick={async () => {
                            setRemovingRel(true);
                            setLocalError("");
                            try {
                              await v1api.deleteRelationship(familyId, row.id);
                              setConfirmRelId(null);
                              setLocalFlash("已移除这条家庭关系");
                              await onChanged();
                            } catch (err) {
                              if (onAuth(err)) return;
                              const msg = userMessageForApiError(err);
                              setLocalError(msg);
                              onError(msg);
                              setConfirmRelId(null);
                            } finally {
                              setRemovingRel(false);
                            }
                          }}
                        >
                          {removingRel ? "移除中…" : "确认移除"}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[color:var(--a-brand)]"
                        onClick={() => setConfirmRelId(row.id)}
                      >
                        移除
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[color:var(--a-muted)]">
              暂无关系。建立父母/配偶关系后，世系页会按代展示。
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            {canEdit ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)]"
                onClick={onRequestAddRel}
              >
                {relRows.length ? "再添加一条关系" : "去添加家庭关系"}
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-brand)]"
              onClick={onShowInLineage}
            >
              在世系中查看
            </button>
          </div>
          <h3 className="mt-6 font-bold text-[color:var(--a-ink)]">人物资料</h3>
          <p className="mt-1 mb-3 text-sm text-[color:var(--a-muted)]">
            记录我们知道的内容，以及资料从哪里来。
          </p>
          {canEdit ? (
            <AddClaimForm
              familyId={familyId}
              personId={person.id}
              canReview={canReview}
              compact
              onAuthError={onAuth}
              onDone={async () => {
                setLocalFlash("已添加人物资料");
                await loadClaims();
              }}
              onError={(msg) => {
                setLocalError(msg);
                onError(msg);
              }}
            />
          ) : null}
          {claimsLoading ? (
            <p className="text-sm text-[color:var(--a-muted)]" role="status">
              正在读取人物资料…
            </p>
          ) : null}
          {[...grouped.entries()].map(([type, rows]) => {
            const conflicted = rows.filter((r) => r.status === "CONFLICTED");
            const label = CLAIM_TYPE_UI[type]?.label ?? type;
            return (
              <section
                key={type}
                className="mb-4 rounded-2xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] p-3"
              >
                <h4 className="font-bold text-[color:var(--a-ink)]">{label}</h4>
                {conflicted.length >= 2 ? (
                  <div className="mt-2 rounded-xl bg-[color:var(--a-warn-soft)] px-3 py-2 ring-1 ring-[color:var(--a-brand-line)]">
                    <p className="font-semibold text-[color:var(--a-brand)]">
                      存在不同说法
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--a-muted)]">
                      目前资料中记录不一致，先保留两种说法，之后可以继续补充来源。
                    </p>
                  </div>
                ) : null}
                <ul className="mt-3 space-y-3">
                  {rows.map((c) => (
                    <ClaimCard
                      key={c.id}
                      familyId={familyId}
                      claim={c}
                      canEdit={canEdit}
                      canReview={canReview}
                      onAuthError={onAuth}
                      onChanged={loadClaims}
                      onError={(msg) => {
                        setLocalError(msg);
                        onError(msg);
                      }}
                      onFlash={setLocalFlash}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {rejectedClaims.length > 0 ? (
            <details className="mt-2 rounded-xl border border-[color:var(--a-brand-line)]/25 bg-[color:var(--a-surface)] p-3">
              <summary className="cursor-pointer font-semibold text-[color:var(--a-muted)]">
                查看不采用的记录（{rejectedClaims.length}）
              </summary>
              <ul className="mt-2 space-y-2 text-sm text-[color:var(--a-muted)]">
                {rejectedClaims.map((c) => (
                  <li key={c.id}>
                    {CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType}：
                    {c.value?.text ?? "—"}（不采用）
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {!claimsLoading && activeClaims.length === 0 ? (
            <p className="text-sm text-[color:var(--a-muted)]">
              {canEdit
                ? "还没有人物资料，可以从出生信息等开始记录。"
                : "暂无人物资料。"}
            </p>
          ) : null}

          {canEdit ? (
            <div className="mt-10 border-t border-[color:var(--a-brand-line)] pt-5">
              {!confirmDelete ? (
                <button
                  type="button"
                  className="alpha-btn alpha-btn-danger w-full !min-h-[44px] !text-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  移除这位成员
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[color:var(--a-danger)]" role="alert">
                    确认移除「{person.preferredName}」？相关家庭关系也会一并取消，此操作用于整理档案，请谨慎。
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="alpha-btn alpha-btn-secondary flex-1"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="alpha-btn alpha-btn-danger flex-1"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        setLocalError("");
                        try {
                          await v1api.deletePerson(familyId, person.id);
                          await onDeleted();
                        } catch (err) {
                          if (onAuth(err)) return;
                          const msg = userMessageForApiError(err);
                          setLocalError(msg);
                          onError(msg);
                          setConfirmDelete(false);
                        } finally {
                          setDeleting(false);
                        }
                      }}
                    >
                      {deleting ? "移除中…" : "确认移除"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-[color:var(--a-ink)]/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-full items-center justify-center py-6">
        <div
          className="alpha-fade-in w-full max-w-md rounded-2xl bg-[color:var(--a-surface-strong)] p-5 shadow-[var(--a-shadow)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-2 text-sm font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)]"
            >
              关闭
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
