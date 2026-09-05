"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [familyName, setFamilyName] = useState("");
  const [surname, setSurname] = useState<string | null>(null);
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
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddRel, setShowAddRel] = useState(false);

  const canEdit = role === "OWNER" || role === "ADMIN" || role === "EDITOR";
  const canReview = role === "OWNER" || role === "ADMIN";

  const personMap = useMemo(() => {
    const m = new Map<string, GraphPerson>();
    for (const p of persons) m.set(p.id, p);
    return m;
  }, [persons]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [fam, list, graph] = await Promise.all([
        v1api.getFamily(familyId),
        v1api.listFamilies(),
        v1api.getGraph(familyId),
      ]);
      setFamilyName(fam.family.displayName);
      setSurname(fam.family.surname);
      const mine = list.families.find((f) => f.id === familyId);
      if (mine?.role) setRole(mine.role);
      setPersons(graph.graph.persons);
      setRelationships(graph.graph.relationships);
      setGenerationByPerson(graph.graph.generationByPerson);
      setComponentCount(graph.graph.componentCount);
    } catch (e) {
      if (handleAuthRedirect(e, router)) return;
      if (e instanceof V1ApiError && e.status === 404) {
        setError(ERROR_COPY.notFound);
      } else {
        setError(userMessageForApiError(e));
      }
    } finally {
      setLoading(false);
    }
  }, [familyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="py-12 text-center text-[#8a6a4a]" role="status">
        正在读取家族成员…
      </p>
    );
  }

  if (error && !familyName) {
    return (
      <p className="py-12 text-center text-[#7a1f1f]" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="py-2">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-[#5c2018]">{familyName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#8a6a4a]">
          {surname ? <span>{surname}</span> : null}
          <span className="rounded-full bg-[#efe6d8] px-2 py-0.5 text-[#5c3a2e]">
            {PRODUCT.privacyFamilyOnly}
          </span>
        </div>
      </header>

      {flash ? (
        <p className="mb-3 rounded-xl bg-[#eef6ee] px-3 py-2 text-sm text-[#2f5d3a]" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-xl bg-[#f8ece8] px-3 py-2 text-sm text-[#7a1f1f]" role="alert">
          {error}
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="家族视图"
        className="mb-4 flex gap-1 rounded-xl bg-[#efe6d8]/80 p-1"
      >
        {(
          [
            ["members", "成员"],
            ["lineage", "世系"],
            ["records", "资料"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm font-bold ${
              tab === id
                ? "bg-white text-[#7a1f1f] shadow-sm"
                : "text-[#6b5344]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <MembersTab
          persons={persons}
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
          onAddRel={() => setShowAddRel(true)}
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
          setFlash={setFlash}
          setError={setError}
        />
      ) : null}

      {showAddPerson ? (
        <AddPersonModal
          familyId={familyId}
          onClose={() => setShowAddPerson(false)}
          onDone={async () => {
            setShowAddPerson(false);
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
          onClose={() => setShowAddRel(false)}
          onDone={async () => {
            setShowAddRel(false);
            setFlash("已添加家庭关系");
            await load();
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}

      {selectedPersonId ? (
        <PersonDrawer
          familyId={familyId}
          person={personMap.get(selectedPersonId)!}
          relationships={relationships}
          personMap={personMap}
          canEdit={canEdit}
          canReview={canReview}
          onClose={() => setSelectedPersonId(null)}
          onChanged={async () => {
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
  canEdit,
  onAdd,
  onOpen,
}: {
  persons: GraphPerson[];
  canEdit: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  if (persons.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d4a76a]/50 bg-white/50 px-4 py-10 text-center">
        <p className="font-bold text-[#5c2018]">还没有家族成员</p>
        <p className="mt-2 text-sm text-[#6b5344]">
          先添加你熟悉的一两位家人即可。
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="mt-5 inline-flex min-h-[48px] items-center rounded-xl bg-[#7a1f1f] px-5 font-bold text-white"
          >
            添加成员
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {canEdit ? (
        <button
          type="button"
          onClick={onAdd}
          className="mb-3 inline-flex min-h-[44px] items-center rounded-xl border border-[#7a1f1f]/40 px-4 text-sm font-bold text-[#7a1f1f]"
        >
          + 添加成员
        </button>
      ) : null}
      <ul className="space-y-2">
        {persons.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              className="flex w-full min-h-[56px] items-center justify-between rounded-2xl border border-[#d4a76a]/30 bg-white/80 px-4 text-left"
            >
              <div>
                <p className="font-bold text-[#5c2018]">{p.preferredName}</p>
                <p className="text-sm text-[#8a6a4a]">
                  {LIVING_STATUS_LABEL[
                    p.livingStatus as keyof typeof LIVING_STATUS_LABEL
                  ] ?? p.livingStatus}
                  {p.gender !== "UNKNOWN"
                    ? ` · ${
                        GENDER_LABEL[p.gender as keyof typeof GENDER_LABEL] ??
                        ""
                      }`
                    : ""}
                </p>
              </div>
              <span className="text-sm text-[#8a6a4a]">查看</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineageTab({
  persons,
  relationships,
  generationByPerson,
  componentCount,
  canEdit,
  onAddRel,
  personMap,
}: {
  persons: GraphPerson[];
  relationships: GraphRel[];
  generationByPerson: Record<string, number>;
  componentCount: number;
  canEdit: boolean;
  onAddRel: () => void;
  personMap: Map<string, GraphPerson>;
}) {
  const byGen = useMemo(() => {
    const map = new Map<number, GraphPerson[]>();
    for (const p of persons) {
      const g = generationByPerson[p.id] ?? 1;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [persons, generationByPerson]);

  const spouses = relationships.filter((r) => r.type === "SPOUSE");

  return (
    <div>
      {canEdit ? (
        <button
          type="button"
          onClick={onAddRel}
          className="mb-3 inline-flex min-h-[44px] items-center rounded-xl border border-[#7a1f1f]/40 px-4 text-sm font-bold text-[#7a1f1f]"
        >
          + 添加家庭关系
        </button>
      ) : null}

      {componentCount > 1 ? (
        <p className="mb-3 text-sm text-[#6b5344]">
          当前档案中有 {componentCount} 个尚未连接的家族分支。
        </p>
      ) : null}

      {byGen.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#d4a76a]/50 px-4 py-8 text-center text-[#8a6a4a]">
          添加成员并建立关系后，这里会按世代展示。
        </p>
      ) : (
        <div className="space-y-6">
          {byGen.map(([gen, list]) => (
            <section key={gen}>
              <h3 className="mb-2 text-sm font-bold tracking-wide text-[#8a6a4a]">
                {generationLabel(gen)}
              </h3>
              <ul className="flex flex-wrap gap-2">
                {list.map((p) => {
                  const spouseNames = spouses
                    .filter(
                      (r) =>
                        r.fromPersonId === p.id || r.toPersonId === p.id
                    )
                    .map((r) => {
                      const oid =
                        r.fromPersonId === p.id
                          ? r.toPersonId
                          : r.fromPersonId;
                      return personMap.get(oid)?.preferredName;
                    })
                    .filter(Boolean);
                  return (
                    <li
                      key={p.id}
                      className="rounded-xl border border-[#d4a76a]/35 bg-white/80 px-3 py-2"
                    >
                      <p className="font-bold text-[#5c2018]">
                        {p.preferredName}
                      </p>
                      {spouseNames.length ? (
                        <p className="text-xs text-[#8a6a4a]">
                          配偶：{spouseNames.join("、")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
  setFlash,
  setError,
}: {
  familyId: string;
  persons: GraphPerson[];
  canEdit: boolean;
  canReview: boolean;
  role: Role;
  onAuthError: (e: unknown) => boolean;
  setFlash: (s: string) => void;
  setError: (s: string) => void;
}) {
  const [personId, setPersonId] = useState(persons[0]?.id ?? "");
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div>
      <p className="mb-3 text-sm leading-relaxed text-[#6b5344]">
        关于这个家族，我们知道些什么，以及这些信息从哪里来。
      </p>
      <label htmlFor="records-person" className="mb-1 block text-sm font-semibold">
        选择成员
      </label>
      <select
        id="records-person"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        className="mb-4 w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3"
      >
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.preferredName}
          </option>
        ))}
      </select>

      {canEdit && personId ? (
        <AddClaimForm
          familyId={familyId}
          personId={personId}
          canReview={canReview}
          onAuthError={onAuthError}
          onDone={async () => {
            setFlash("已添加人物资料");
            await loadClaims();
          }}
          onError={setError}
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-[#8a6a4a]" role="status">
          正在读取人物资料…
        </p>
      ) : null}

      {[...grouped.entries()].map(([type, rows]) => {
        const conflicted = rows.filter((r) => r.status === "CONFLICTED");
        const label = CLAIM_TYPE_UI[type]?.label ?? type;
        return (
          <section
            key={type}
            className="mb-4 rounded-2xl border border-[#d4a76a]/30 bg-white/70 p-4"
          >
            <h3 className="font-bold text-[#5c2018]">{label}</h3>
            {conflicted.length >= 2 ? (
              <div className="mt-2 rounded-xl bg-[#fff6e8] px-3 py-2">
                <p className="font-semibold text-[#8a4b12]">存在不同说法</p>
                <p className="mt-1 text-sm text-[#6b5344]">
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
        <details className="mt-4 rounded-xl border border-[#d4a76a]/25 bg-white/50 p-3">
          <summary className="cursor-pointer font-semibold text-[#8a6a4a]">
            查看不采用的记录（{rejected.length}）
          </summary>
          <ul className="mt-2 space-y-2 text-sm text-[#6b5344]">
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
        <p className="text-sm text-[#8a6a4a]">
          {role === "VIEWER"
            ? "暂无人物资料。"
            : "还没有人物资料，可以从出生信息等开始记录。"}
        </p>
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
}: {
  familyId: string;
  personId: string;
  canReview: boolean;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [claimType, setClaimType] = useState("BIRTH_DATE");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await v1api.createClaim(familyId, {
        subjectId: personId,
        claimType,
        value: { text: text.trim() },
      });
      setText("");
      await onDone();
    } catch (err) {
      if (onAuthError(err)) return;
      onError(userMessageForApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-5 space-y-3 rounded-2xl border border-[#d4a76a]/35 bg-white/80 p-4"
    >
      <p className="font-bold text-[#5c2018]">添加人物资料</p>
      <div>
        <label htmlFor="claim-type" className="mb-1 block text-sm font-semibold">
          资料类型
        </label>
        <select
          id="claim-type"
          value={claimType}
          onChange={(e) => setClaimType(e.target.value)}
          className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3"
        >
          {Object.entries(CLAIM_TYPE_UI).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="claim-text" className="mb-1 block text-sm font-semibold">
          {CLAIM_TYPE_UI[claimType]?.label ?? "内容"}
        </label>
        <input
          id="claim-text"
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={CLAIM_TYPE_UI[claimType]?.placeholder}
          className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3"
        />
      </div>
      <p className="text-xs text-[#8a6a4a]">
        保存后为「待确认」
        {canReview ? "，可继续添加资料来源后再确认。" : "。"}
      </p>
      <button
        type="submit"
        disabled={busy}
        className="min-h-[44px] rounded-xl bg-[#7a1f1f] px-4 font-bold text-white disabled:opacity-60"
      >
        {busy ? "保存中…" : "保存资料"}
      </button>
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

  return (
    <li className="rounded-xl border border-[#efe6d8] bg-[#faf7f2] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[#3d2a1f]">
            {claim.value?.text ?? "—"}
          </p>
          <p className="mt-1 text-sm text-[#8a6a4a]">{statusLabel}</p>
        </div>
        {canReview && claim.status === "PROPOSED" ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-[40px] rounded-lg bg-[#7a1f1f] px-3 text-sm font-bold text-white"
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
              className="min-h-[40px] rounded-lg border border-[#d4a76a]/50 px-3 text-sm font-semibold"
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
            className="min-h-[40px] rounded-lg border border-[#d4a76a]/50 px-3 text-sm font-semibold"
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
        <ul className="mt-3 space-y-2 border-t border-[#efe6d8] pt-2 text-sm">
          {bundle.evidenceLinks.map((l) => (
            <li key={l.evidence.id} className="text-[#6b5344]">
              <span className="font-semibold">
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
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-[#7a1f1f]"
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
      className="ml-2 underline"
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
  const [busy, setBusy] = useState(false);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    leaveWarn.current = true;
    try {
      let mediaObjectId: string | null = null;
      if (file) {
        const mime = mimeFromFile(file);
        if (!mime) {
          onError("不支持的文件类型。请选择图片、PDF、音频或视频。");
          return;
        }
        const max = MEDIA_MAX_BYTES[mime] ?? 0;
        if (file.size > max) {
          const mb = Math.round(max / (1024 * 1024));
          onError(
            mime.startsWith("image/")
              ? `图片最大 ${mb} MB。`
              : mime === "application/pdf"
                ? `PDF 最大 ${mb} MB。`
                : `该类型文件最大 ${mb} MB。`
          );
          return;
        }
        setUploadState("准备上传");
        const reserved = await v1api.reserveMedia(familyId, {
          originalFilename: file.name,
          mimeType: mime,
          byteSize: file.size,
        });
        setUploadState("正在上传…");
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
        setUploadState("正在保存");
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const st = await v1api.mediaStatus(familyId, reserved.media.id);
          if (st.status === "ACTIVE") {
            mediaObjectId = reserved.media.id;
            setUploadState("上传完成");
            break;
          }
          if (st.status === "FAILED") {
            throw new Error("upload failed");
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!mediaObjectId) {
          onError("上传超时，请稍后重试。");
          return;
        }
      }

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
      await onDone();
    } catch (err) {
      if (onAuthError(err)) return;
      onError(
        uploadState
          ? "上传失败，请检查文件后重试。"
          : userMessageForApiError(err)
      );
    } finally {
      leaveWarn.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[#d4a76a]/40 bg-white p-3">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="ev-type" className="mb-1 block text-sm font-semibold">
            来源类型
          </label>
          <select
            id="ev-type"
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-[#d4a76a]/50 px-2"
          >
            {Object.entries(EVIDENCE_TYPE_UI).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ev-title" className="mb-1 block text-sm font-semibold">
            来源标题（可选）
          </label>
          <input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-[#d4a76a]/50 px-2"
          />
        </div>
        <div>
          <label htmlFor="ev-loc" className="mb-1 block text-sm font-semibold">
            出处位置（可选）
          </label>
          <input
            id="ev-loc"
            value={sourceLocator}
            onChange={(e) => setSourceLocator(e.target.value)}
            placeholder="例如：第17页"
            className="w-full min-h-[44px] rounded-lg border border-[#d4a76a]/50 px-2"
          />
        </div>
        <div>
          <label htmlFor="ev-desc" className="mb-1 block text-sm font-semibold">
            来源说明（可选）
          </label>
          <textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[#d4a76a]/50 px-2 py-2"
          />
        </div>
        <div>
          <label htmlFor="ev-file" className="mb-1 block text-sm font-semibold">
            附件（可选）
          </label>
          <input
            id="ev-file"
            type="file"
            accept={ALLOWED_EXT.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          <p className="mt-1 text-xs text-[#8a6a4a]">
            支持 JPG/PNG/WEBP/PDF 与常见音视频。图片最大 20 MB。仅家族成员可见。
          </p>
          {uploadState ? (
            <p className="mt-1 text-sm text-[#6b5344]" role="status">
              {uploadState}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-lg border border-[#d4a76a]/40"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg bg-[#7a1f1f] font-bold text-white disabled:opacity-60"
          >
            {busy ? "保存中…" : "保存来源"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddPersonModal({
  familyId,
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const [name, setName] = useState("");
  const [living, setLiving] = useState("UNKNOWN");
  const [gender, setGender] = useState("UNKNOWN");
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await v1api.createPerson(familyId, {
        preferredName: name.trim(),
        livingStatus: living,
        gender,
      });
      await onDone();
    } catch (err) {
      if (onAuth(err)) return;
      onError(userMessageForApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="添加成员" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="p-name" className="mb-1 block text-sm font-semibold">
            姓名 / 常用称呼 *
          </label>
          <input
            ref={firstRef}
            id="p-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 px-3"
          />
        </div>
        <div>
          <label htmlFor="p-living" className="mb-1 block text-sm font-semibold">
            是否仍在世
          </label>
          <select
            id="p-living"
            value={living}
            onChange={(e) => setLiving(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 px-3"
          >
            <option value="UNKNOWN">不确定</option>
            <option value="LIVING">在世</option>
            <option value="DECEASED">已故</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-gender" className="mb-1 block text-sm font-semibold">
            性别（可选）
          </label>
          <select
            id="p-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 px-3"
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
            className="min-h-[44px] flex-1 rounded-xl border"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl bg-[#7a1f1f] font-bold text-white"
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
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  persons: GraphPerson[];
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const [mode, setMode] = useState<"parent" | "spouse">("parent");
  const [parentId, setParentId] = useState(persons[0]?.id ?? "");
  const [childId, setChildId] = useState(persons[1]?.id ?? persons[0]?.id ?? "");
  const [parentType, setParentType] = useState("BIOLOGICAL_PARENT");
  const [aId, setAId] = useState(persons[0]?.id ?? "");
  const [bId, setBId] = useState(persons[1]?.id ?? persons[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "parent") {
        await v1api.createRelationship(familyId, {
          fromPersonId: parentId,
          toPersonId: childId,
          relationshipType: parentType,
        });
      } else {
        await v1api.createRelationship(familyId, {
          fromPersonId: aId,
          toPersonId: bId,
          relationshipType: "SPOUSE",
        });
      }
      await onDone();
    } catch (err) {
      if (onAuth(err)) return;
      onError(userMessageForApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="添加家庭关系" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            className={`min-h-[40px] flex-1 rounded-lg text-sm font-bold ${
              mode === "parent" ? "bg-[#7a1f1f] text-white" : "border"
            }`}
            onClick={() => setMode("parent")}
          >
            父母 → 子女
          </button>
          <button
            type="button"
            className={`min-h-[40px] flex-1 rounded-lg text-sm font-bold ${
              mode === "spouse" ? "bg-[#7a1f1f] text-white" : "border"
            }`}
            onClick={() => setMode("spouse")}
          >
            配偶
          </button>
        </div>
        {mode === "parent" ? (
          <>
            <div>
              <label htmlFor="rel-parent" className="mb-1 block text-sm font-semibold">
                父母人物
              </label>
              <select
                id="rel-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-child" className="mb-1 block text-sm font-semibold">
                子女人物
              </label>
              <select
                id="rel-child"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-type" className="mb-1 block text-sm font-semibold">
                关系类型
              </label>
              <select
                id="rel-type"
                value={parentType}
                onChange={(e) => setParentType(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
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
              <label htmlFor="rel-a" className="mb-1 block text-sm font-semibold">
                成员一
              </label>
              <select
                id="rel-a"
                value={aId}
                onChange={(e) => setAId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
              >
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rel-b" className="mb-1 block text-sm font-semibold">
                成员二
              </label>
              <select
                id="rel-b"
                value={bId}
                onChange={(e) => setBId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
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
          <button type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-xl border">
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl bg-[#7a1f1f] font-bold text-white"
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
  relationships,
  personMap,
  canEdit,
  canReview,
  onClose,
  onChanged,
  onError,
  onAuth,
}: {
  familyId: string;
  person: GraphPerson;
  relationships: GraphRel[];
  personMap: Map<string, GraphPerson>;
  canEdit: boolean;
  canReview: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(person.preferredName);
  const [revision, setRevision] = useState(person.revisionNo);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const relLines = relationships
    .filter((r) => r.fromPersonId === person.id || r.toPersonId === person.id)
    .map((r) => {
      const other =
        r.fromPersonId === person.id ? r.toPersonId : r.fromPersonId;
      const otherName = personMap.get(other)?.preferredName ?? "成员";
      if (r.type === "SPOUSE") return `配偶：${otherName}`;
      if (r.fromPersonId === person.id) return `子女：${otherName}`;
      return `父母：${otherName}`;
    });

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setLocalError("");
    try {
      const res = await v1api.patchPerson(familyId, person.id, {
        expectedRevision: revision,
        preferredName: name.trim(),
      });
      setRevision(res.person.revisionNo);
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
      className="fixed inset-0 z-40 flex justify-end bg-black/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-drawer-title"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-[#faf7f2] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d4a76a]/30 px-4 py-3">
          <h2 id="person-drawer-title" className="text-lg font-bold text-[#5c2018]">
            {person.preferredName}
          </h2>
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg text-sm font-semibold"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {localError ? (
            <p className="mb-3 rounded-xl bg-[#f8ece8] px-3 py-2 text-sm text-[#7a1f1f]" role="alert">
              {localError}
            </p>
          ) : null}
          <p className="text-sm text-[#8a6a4a]">
            {LIVING_STATUS_LABEL[
              person.livingStatus as keyof typeof LIVING_STATUS_LABEL
            ]}
          </p>
          {canEdit ? (
            <form
              onSubmit={saveName}
              className="mt-4 space-y-2"
              data-revision={revision}
            >
              <label htmlFor="edit-name" className="block text-sm font-semibold">
                姓名
              </label>
              <input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border px-3"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-[40px] rounded-lg bg-[#7a1f1f] px-3 text-sm font-bold text-white"
              >
                保存姓名
              </button>
            </form>
          ) : null}
          <h3 className="mt-6 font-bold text-[#5c2018]">家庭关系</h3>
          {relLines.length ? (
            <ul className="mt-2 space-y-1 text-sm text-[#6b5344]">
              {relLines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[#8a6a4a]">暂无关系</p>
          )}
          <h3 className="mt-6 font-bold text-[#5c2018]">人物资料</h3>
          <p className="mt-1 text-sm text-[#8a6a4a]">
            请到「资料」页查看与编辑完整记录。
            {canReview ? "" : ""}
          </p>
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#faf7f2] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#5c2018]">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-[40px] px-2 text-sm font-semibold">
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
