"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
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
  CLAIM_ORIGIN_LABEL,
  CLAIM_STATUS_LABEL,
  CLAIM_TYPE_UI,
  EVIDENCE_TYPE_UI,
  ERROR_COPY,
  GENDER_LABEL,
  LIVING_STATUS_LABEL,
  PRODUCT,
  ROLE_LABEL,
  generationLabel,
  generationSongChars,
  birthOrderRank,
  generationWordsByGeneration,
} from "@/v1/ui/copy";
import {
  userMessageForApiError,
  v1api,
  V1ApiError,
} from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";
import { useFocusTrap } from "@/components/alpha/useFocusTrap";
import { OverviewTab } from "@/components/alpha/OverviewTab";
import { MEDIA_MAX_BYTES } from "@/v1/domain/media/types";
import { listMultiClaimTypes } from "@/v1/domain/claim/registry";

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
  value: { text?: string; narrator?: string | null };
  status: string;
  originType?: string;
  confidence?: number | null;
};

type Tab = "overview" | "members" | "lineage" | "records";

const TAB_IDS: readonly Tab[] = ["overview", "members", "lineage", "records"];

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

function useLockBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

function scrollIntoViewSafe(
  el: HTMLElement,
  options: ScrollIntoViewOptions = {}
) {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    ...options,
    behavior: reduce ? "auto" : options.behavior ?? "smooth",
  });
}

/** Confirmed 字辈 per person; empty until loaded and on failure (it is only a hint). */
function useGenerationWords(
  familyId: string,
  enabled: boolean,
  version: number = 0
) {
  const [words, setWords] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    v1api
      .getGenerationWords(familyId)
      .then((r) => {
        if (!cancelled) setWords(r.generationWords);
      })
      .catch(() => {
        /* hint only */
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, enabled, version]);
  return words;
}

function useBirthOrders(
  familyId: string,
  enabled: boolean,
  version: number = 0
) {
  const [orders, setOrders] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    v1api
      .getBirthOrders(familyId)
      .then((r) => {
        if (!cancelled) setOrders(r.birthOrders);
      })
      .catch(() => {
        /* hint only */
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, enabled, version]);
  return orders;
}

const PARENT_EDGE_TYPES = new Set([
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
]);

function siblingIdsForPerson(
  personId: string,
  relationships: GraphRel[]
): string[] {
  const parentIds = new Set<string>();
  for (const r of relationships) {
    if (PARENT_EDGE_TYPES.has(r.type) && r.toPersonId === personId) {
      parentIds.add(r.fromPersonId);
    }
  }
  if (parentIds.size === 0) return [];
  const sibs = new Set<string>();
  for (const r of relationships) {
    if (
      PARENT_EDGE_TYPES.has(r.type) &&
      parentIds.has(r.fromPersonId) &&
      r.toPersonId !== personId
    ) {
      sibs.add(r.toPersonId);
    }
  }
  return [...sibs];
}

export function FamilyWorkspace({
  familyId,
  initialRole,
}: {
  familyId: string;
  initialRole?: Role;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [dataVersion, setDataVersion] = useState(0);
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [pendingUndo, setPendingUndo] = useState<null | {
    kind: "person" | "relationship" | "evidence" | "evidence-link" | "claim";
    id: string;
    label: string;
    claimId?: string;
    evidenceId?: string;
    relation?: string;
  }>(null);

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [lineageFocusId, setLineageFocusId] = useState<string | null>(null);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddRel, setShowAddRel] = useState(false);
  const [showAddKin, setShowAddKin] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [relFocusPersonId, setRelFocusPersonId] = useState<string | null>(null);
  const [kinRole, setKinRole] = useState<"child" | "parent" | "spouse">(
    "child"
  );
  const [drawerExternalSeed, setDrawerExternalSeed] = useState<{
    claimType: string;
    nonce: number;
  } | null>(null);
  const [drawerBasicsFocus, setDrawerBasicsFocus] = useState<
    "living" | "gender" | "name" | null
  >(null);

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
      setDataVersion((v) => v + 1);
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
    // Skip the first save after restore so the default tab cannot overwrite
    // a previously saved tab (esp. under React Strict Mode remount).
    tabReady.current = false;
    try {
      const saved = sessionStorage.getItem(`alpha-tab:${familyId}`);
      setTab(
        saved && (TAB_IDS as readonly string[]).includes(saved)
          ? (saved as Tab)
          : "overview"
      );
    } catch {
      setTab("overview");
    }
  }, [familyId]);

  const [claimSeed, setClaimSeed] = useState<{
    personId: string;
    claimType: string;
    nonce: number;
  } | null>(null);
  const [evidenceSeed, setEvidenceSeed] = useState<{
    personId: string;
    claimId: string;
    evidenceType?: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(
        `alpha-records-claim-seed:${familyId}`
      );
      if (!raw) return;
      sessionStorage.removeItem(`alpha-records-claim-seed:${familyId}`);
      const parsed = JSON.parse(raw) as {
        personId?: string;
        claimType?: string;
        nonce?: number;
      };
      if (parsed.personId && parsed.claimType) {
        setClaimSeed({
          personId: parsed.personId,
          claimType: parsed.claimType,
          nonce: parsed.nonce ?? Date.now(),
        });
        setTab("records");
      }
    } catch {
      /* private mode / bad JSON */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(
        `alpha-records-evidence-seed:${familyId}`
      );
      if (!raw) return;
      sessionStorage.removeItem(`alpha-records-evidence-seed:${familyId}`);
      const parsed = JSON.parse(raw) as {
        personId?: string;
        claimId?: string;
        evidenceType?: string;
        nonce?: number;
      };
      if (parsed.personId && parsed.claimId) {
        setEvidenceSeed({
          personId: parsed.personId,
          claimId: parsed.claimId,
          evidenceType: parsed.evidenceType,
          nonce: parsed.nonce ?? Date.now(),
        });
        setTab("records");
      }
    } catch {
      /* private mode / bad JSON */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`alpha-add-kin:${familyId}`);
      if (!raw) return;
      sessionStorage.removeItem(`alpha-add-kin:${familyId}`);
      const parsed = JSON.parse(raw) as {
        personId?: string;
        role?: "child" | "parent" | "spouse";
      };
      if (
        parsed.personId &&
        (parsed.role === "child" ||
          parsed.role === "parent" ||
          parsed.role === "spouse")
      ) {
        setRelFocusPersonId(parsed.personId);
        setKinRole(parsed.role);
        setShowAddKin(true);
        setTab("lineage");
      }
    } catch {
      /* private mode / bad JSON */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const flag = sessionStorage.getItem(`alpha-add-rel:${familyId}`);
      if (!flag) return;
      sessionStorage.removeItem(`alpha-add-rel:${familyId}`);
      setShowAddRel(true);
      setTab("lineage");
    } catch {
      /* private mode */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const flag = sessionStorage.getItem(`alpha-add-person:${familyId}`);
      if (!flag) return;
      sessionStorage.removeItem(`alpha-add-person:${familyId}`);
      setShowAddPerson(true);
      setTab("members");
    } catch {
      /* private mode */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`alpha-person-basics:${familyId}`);
      if (!raw) return;
      sessionStorage.removeItem(`alpha-person-basics:${familyId}`);
      const parsed = JSON.parse(raw) as {
        personId?: string;
        focus?: "living" | "gender" | "name";
      };
      if (
        parsed.personId &&
        (parsed.focus === "living" ||
          parsed.focus === "gender" ||
          parsed.focus === "name")
      ) {
        setDrawerBasicsFocus(parsed.focus);
        setSelectedPersonId(parsed.personId);
        setTab("lineage");
      }
    } catch {
      /* private mode / bad JSON */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const id = sessionStorage.getItem(`alpha-lineage-focus:${familyId}`);
      if (!id) return;
      sessionStorage.removeItem(`alpha-lineage-focus:${familyId}`);
      setLineageFocusId(id);
      setTab("lineage");
    } catch {
      /* private mode */
    }
  }, [familyId]);

  const [recordsFocus, setRecordsFocus] = useState<{
    personId: string;
    claimId: string;
    statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
    nonce: number;
  } | null>(null);
  const [sourcesFocusEvidenceId, setSourcesFocusEvidenceId] = useState<
    string | null
  >(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`alpha-records-focus:${familyId}`);
      if (!raw) return;
      sessionStorage.removeItem(`alpha-records-focus:${familyId}`);
      const parsed = JSON.parse(raw) as {
        personId?: string;
        claimId?: string;
        statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
        nonce?: number;
      };
      if (parsed.personId && parsed.claimId) {
        setRecordsFocus({
          personId: parsed.personId,
          claimId: parsed.claimId,
          statusFilter: parsed.statusFilter,
          nonce: parsed.nonce ?? Date.now(),
        });
        setTab("records");
      }
    } catch {
      /* private mode / bad JSON */
    }
  }, [familyId]);

  useEffect(() => {
    try {
      const id = sessionStorage.getItem(`alpha-evidence-focus:${familyId}`);
      if (!id) return;
      sessionStorage.removeItem(`alpha-evidence-focus:${familyId}`);
      setSourcesFocusEvidenceId(id);
      setTab("overview");
    } catch {
      /* private mode */
    }
  }, [familyId]);

  const openRecordsFor = useCallback(
    (
      personId: string,
      opts?:
        | string
        | {
            claimType?: string;
            focusClaimId?: string;
            statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
            /** Open the attach-evidence composer for focusClaimId. */
            openEvidence?: boolean;
            evidenceType?: string;
          }
    ) => {
      const resolved =
        typeof opts === "string" ? { claimType: opts } : opts ?? {};
      try {
        sessionStorage.setItem(`alpha-records-person:${familyId}`, personId);
      } catch {
        /* private mode */
      }
      if (resolved.claimType) {
        setClaimSeed({
          personId,
          claimType: resolved.claimType,
          nonce: Date.now(),
        });
      }
      if (resolved.focusClaimId) {
        setRecordsFocus({
          personId,
          claimId: resolved.focusClaimId,
          statusFilter: resolved.statusFilter,
          nonce: Date.now(),
        });
        if (resolved.openEvidence) {
          setEvidenceSeed({
            personId,
            claimId: resolved.focusClaimId,
            evidenceType: resolved.evidenceType,
            nonce: Date.now(),
          });
        }
      }
      setTab("records");
    },
    [familyId]
  );

  const authRedirect = useCallback(
    (e: unknown) => handleAuthRedirect(e, router),
    [router]
  );

  useEffect(() => {
    if (!tabReady.current) {
      tabReady.current = true;
      return;
    }
    try {
      sessionStorage.setItem(`alpha-tab:${familyId}`, tab);
    } catch {
      /* private mode */
    }
  }, [familyId, tab]);

  useEffect(() => {
    if (!flash || pendingUndo) return;
    const t = window.setTimeout(() => setFlash(""), 8000);
    return () => window.clearTimeout(t);
  }, [flash, pendingUndo]);

  useEffect(() => {
    if (!lineageFocusId) return;
    const t = window.setTimeout(() => setLineageFocusId(null), 4500);
    return () => window.clearTimeout(t);
  }, [lineageFocusId]);

  const tabsOrder = useMemo(
    () =>
      [
        ["overview", "概览"],
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => {
                if (refreshing) return;
                setRefreshing(true);
                void (async () => {
                  try {
                    await load();
                    setFlash("已刷新");
                  } finally {
                    setRefreshing(false);
                  }
                })();
              }}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
            >
              {refreshing ? "刷新中…" : "刷新"}
            </button>
            {canReview ? (
              <button
                type="button"
                onClick={() => setShowEditFamily(true)}
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
              >
                编辑档案
              </button>
            ) : null}
            {role !== "OWNER" ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "确认退出这个家族？退出后需再次受邀才能加入。"
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    try {
                      await v1api.leaveFamily(familyId, {
                        idempotencyKey: crypto.randomUUID(),
                      });
                      router.push("/alpha/families");
                    } catch (e) {
                      if (handleAuthRedirect(e, router)) return;
                      setError(userMessageForApiError(e));
                    }
                  })();
                }}
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm text-[color:var(--a-danger)]"
              >
                退出家族
              </button>
            ) : null}
          </div>
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
        <div
          className="mb-3 flex flex-wrap items-start justify-between gap-3 alpha-alert alpha-alert-ok"
          role="status"
        >
          <p className="min-w-0 flex-1">{flash}</p>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {pendingUndo ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  const undo = pendingUndo;
                  setPendingUndo(null);
                  setFlash("");
                  void (async () => {
                    try {
                      if (undo.kind === "person") {
                        const r = await v1api.restorePerson(
                          familyId,
                          undo.id,
                          { idempotencyKey: crypto.randomUUID() }
                        );
                        setFlash(
                          `已恢复「${r.person.preferredName}」${
                            r.relationshipsRestoredCount > 0
                              ? `，并恢复了 ${r.relationshipsRestoredCount} 条家庭关系`
                              : ""
                          }`
                        );
                      } else if (undo.kind === "relationship") {
                        await v1api.restoreRelationship(familyId, undo.id, {
                          idempotencyKey: crypto.randomUUID(),
                        });
                        setFlash(`已恢复${undo.label}`);
                      } else if (undo.kind === "evidence") {
                        const r = await v1api.restoreEvidence(
                          familyId,
                          undo.id,
                          { idempotencyKey: crypto.randomUUID() }
                        );
                        const label =
                          r.evidence.title?.trim() || undo.label || "资料来源";
                        setFlash(`已恢复「${label}」`);
                        setSourcesFocusEvidenceId(r.evidence.id);
                      } else if (
                        undo.kind === "evidence-link" &&
                        undo.claimId &&
                        undo.evidenceId
                      ) {
                        await v1api.linkEvidence(
                          familyId,
                          undo.claimId,
                          {
                            evidenceId: undo.evidenceId,
                            relation: undo.relation ?? "SUPPORTS",
                          },
                          { idempotencyKey: crypto.randomUUID() }
                        );
                        setFlash(`已恢复「${undo.label}」的挂接`);
                      } else if (undo.kind === "claim") {
                        await v1api.reopenClaim(familyId, undo.id, {
                          idempotencyKey: crypto.randomUUID(),
                        });
                        setFlash(
                          "已重新打开这条资料，可再次确认或不采用"
                        );
                      }
                      await load();
                    } catch (e) {
                      if (handleAuthRedirect(e, router)) return;
                      setError(userMessageForApiError(e));
                    }
                  })();
                }}
              >
                恢复
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-ok)] underline-offset-2 hover:underline"
              onClick={() => {
                setFlash("");
                setPendingUndo(null);
              }}
              aria-label="关闭提示"
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
      {error && !flash ? (
        <div
          className="mb-3 flex items-start justify-between gap-3 alpha-alert alpha-alert-error"
          role="alert"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <button
            type="button"
            className="shrink-0 text-sm font-semibold underline-offset-2 hover:underline"
            onClick={() => setError("")}
            aria-label="关闭错误提示"
          >
            关闭
          </button>
        </div>
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
            id={`alpha-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`alpha-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className="alpha-tab"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div
          id="alpha-panel-overview"
          role="tabpanel"
          aria-labelledby="alpha-tab-overview"
        >
          <OverviewTab
            familyId={familyId}
            persons={persons}
            relationships={relationships}
            componentCount={componentCount}
            generationByPerson={generationByPerson}
            dataVersion={dataVersion}
            canEdit={canEdit}
            canReview={canReview}
            onAddPerson={() => setShowAddPerson(true)}
            onAddRel={() => {
              setRelFocusPersonId(null);
              setShowAddRel(true);
            }}
            onAddKin={(personId, role) => {
              setRelFocusPersonId(personId);
              setKinRole(role);
              setShowAddKin(true);
            }}
            onOpenPerson={(personId, basicsFocus) => {
              setDrawerBasicsFocus(basicsFocus ?? null);
              setSelectedPersonId(personId);
            }}
            onOpenRecords={openRecordsFor}
            onOpenLineage={(personId) => {
              setLineageFocusId(personId);
              setTab("lineage");
            }}
            onRestorePerson={async (personId) => {
              try {
                const r = await v1api.restorePerson(familyId, personId, {
                  idempotencyKey: crypto.randomUUID(),
                });
                setFlash(
                  `已恢复「${r.person.preferredName}」${
                    r.relationshipsRestoredCount > 0
                      ? `，并恢复了 ${r.relationshipsRestoredCount} 条家庭关系`
                      : ""
                  }`
                );
                await load();
              } catch (e) {
                if (authRedirect(e)) return;
                setError(userMessageForApiError(e));
              }
            }}
            onRestoreRelationship={async (relationshipId) => {
              try {
                const r = await v1api.restoreRelationship(
                  familyId,
                  relationshipId,
                  { idempotencyKey: crypto.randomUUID() }
                );
                const from =
                  persons.find((p) => p.id === r.relationship.fromPersonId)
                    ?.preferredName ?? "成员";
                const to =
                  persons.find((p) => p.id === r.relationship.toPersonId)
                    ?.preferredName ?? "成员";
                setFlash(`已恢复「${from}」与「${to}」的家庭关系`);
                await load();
              } catch (e) {
                if (authRedirect(e)) return;
                setError(userMessageForApiError(e));
              }
            }}
            onRestoreEvidence={async (evidenceId) => {
              try {
                const r = await v1api.restoreEvidence(familyId, evidenceId, {
                  idempotencyKey: crypto.randomUUID(),
                });
                const label = r.evidence.title?.trim() || "资料来源";
                setFlash(`已恢复「${label}」`);
                setPendingUndo(null);
                await load();
                setSourcesFocusEvidenceId(r.evidence.id);
              } catch (e) {
                if (authRedirect(e)) return;
                setError(userMessageForApiError(e));
              }
            }}
            onEvidenceRemoved={(evidenceId, label) => {
              setError("");
              setPendingUndo({ kind: "evidence", id: evidenceId, label });
              setFlash(`已移除「${label}」。误删可点恢复。`);
            }}
            onReopenClaim={async (personId, claimId) => {
              try {
                await v1api.reopenClaim(familyId, claimId, {
                  idempotencyKey: crypto.randomUUID(),
                });
                setFlash("已重新打开这条资料，可再次确认或不采用");
                await load();
                openRecordsFor(personId, {
                  focusClaimId: claimId,
                  statusFilter: "PROPOSED",
                });
              } catch (e) {
                if (authRedirect(e)) return;
                setError(userMessageForApiError(e));
              }
            }}
            onReload={load}
            onAuthError={authRedirect}
            externalFocusEvidenceId={sourcesFocusEvidenceId}
            onExternalFocusEvidenceConsumed={() =>
              setSourcesFocusEvidenceId(null)
            }
          />
        </div>
      ) : null}

      {tab === "members" ? (
        <div
          id="alpha-panel-members"
          role="tabpanel"
          aria-labelledby="alpha-tab-members"
        >
          <MembersTab
            persons={persons}
            generationByPerson={generationByPerson}
            showGenerations={relationships.length > 0}
            canEdit={canEdit}
            onAdd={() => setShowAddPerson(true)}
            onOpen={(id) => setSelectedPersonId(id)}
          />
        </div>
      ) : null}

      {tab === "lineage" ? (
        <div
          id="alpha-panel-lineage"
          role="tabpanel"
          aria-labelledby="alpha-tab-lineage"
        >
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
            onAddKin={(personId, role) => {
              setRelFocusPersonId(personId);
              setKinRole(role);
              setShowAddKin(true);
            }}
            onGoMembers={() => {
              setTab("members");
              setShowAddPerson(true);
            }}
            onOpen={(id) => setSelectedPersonId(id)}
            personMap={personMap}
            familyId={familyId}
            dataVersion={dataVersion}
          />
        </div>
      ) : null}

      {tab === "records" ? (
        <div
          id="alpha-panel-records"
          role="tabpanel"
          aria-labelledby="alpha-tab-records"
        >
          <RecordsTab
            familyId={familyId}
            persons={persons}
            relationships={relationships}
            generationByPerson={generationByPerson}
            canEdit={canEdit}
            canReview={canReview}
            role={role}
            claimSeed={claimSeed}
            onClaimSeedConsumed={() => setClaimSeed(null)}
            evidenceSeed={evidenceSeed}
            onEvidenceSeedConsumed={() => setEvidenceSeed(null)}
            recordsFocus={recordsFocus}
            onRecordsFocusConsumed={() => setRecordsFocus(null)}
            onOpenSourcesLibrary={(evidenceId) => {
              setSourcesFocusEvidenceId(evidenceId);
              setTab("overview");
            }}
            onAuthError={(e) => handleAuthRedirect(e, router)}
            onOpenPerson={(id) => setSelectedPersonId(id)}
            onGoMembers={() => {
              setTab("members");
              setShowAddPerson(true);
            }}
            setFlash={setFlash}
            setPendingUndo={(undo) => setPendingUndo(undo)}
            setError={setError}
            onEvidenceRemoved={(evidenceId, label) => {
              setError("");
              setPendingUndo({ kind: "evidence", id: evidenceId, label });
              setFlash(`已移除「${label}」。误删可点恢复。`);
            }}
            onEvidenceUnlinked={(args) => {
              setError("");
              setPendingUndo({
                kind: "evidence-link",
                id: `${args.claimId}:${args.evidenceId}`,
                label: args.label,
                claimId: args.claimId,
                evidenceId: args.evidenceId,
                relation: args.relation,
              });
              setFlash(`已取消「${args.label}」的挂接。误取消可点恢复。`);
            }}
          />
        </div>
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
          onFinished={(count) => {
            setShowAddPerson(false);
            if (count > 0) {
              if (tab === "overview") setTab("members");
              setError("");
              setFlash(
                count === 1
                  ? "已添加家族成员"
                  : `已添加 ${count} 位家族成员`
              );
            }
          }}
          onAdded={async () => {
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
          onNeedMorePeople={() => {
            setShowAddRel(false);
            setRelFocusPersonId(null);
            setShowAddPerson(true);
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

      {showAddKin && relFocusPersonId ? (
        <AddKinModal
          familyId={familyId}
          persons={persons}
          focusPersonId={relFocusPersonId}
          initialRole={kinRole}
          onClose={() => {
            setShowAddKin(false);
            setRelFocusPersonId(null);
          }}
          onDone={async (result) => {
            setShowAddKin(false);
            setRelFocusPersonId(null);
            setError("");
            setFlash(
              result.createdName
                ? `已添加「${result.createdName}」并建立关系`
                : "已添加家庭关系"
            );
            await load();
            if (result.newPersonId) {
              setDrawerExternalSeed({
                claimType: result.seedClaimType,
                nonce: Date.now(),
              });
              setSelectedPersonId(result.newPersonId);
            }
          }}
          onError={(msg) => setError(msg)}
          onAuth={(e) => handleAuthRedirect(e, router)}
        />
      ) : null}

      {selectedPersonId && personMap.get(selectedPersonId) ? (
        <PersonDrawer
          familyId={familyId}
          person={personMap.get(selectedPersonId)!}
          persons={persons}
          generation={
            relationships.length > 0
              ? generationByPerson[selectedPersonId]
              : undefined
          }
          generationByPerson={generationByPerson}
          relationships={relationships}
          personMap={personMap}
          canEdit={canEdit}
          canReview={canReview}
          externalClaimSeed={drawerExternalSeed}
          onExternalClaimSeedConsumed={() => setDrawerExternalSeed(null)}
          basicsFocus={drawerBasicsFocus}
          onBasicsFocusConsumed={() => setDrawerBasicsFocus(null)}
          onClose={() => {
            setSelectedPersonId(null);
            setDrawerExternalSeed(null);
            setDrawerBasicsFocus(null);
          }}
          onChanged={async () => {
            await load();
          }}
          onRequestAddRel={() => {
            const pid = selectedPersonId;
            setSelectedPersonId(null);
            setDrawerBasicsFocus(null);
            if (persons.length < 2) {
              setTab("members");
              setShowAddPerson(true);
              return;
            }
            setTab("lineage");
            setRelFocusPersonId(pid);
            setShowAddRel(true);
          }}
          onRequestAddKin={(role) => {
            const pid = selectedPersonId;
            setSelectedPersonId(null);
            setDrawerBasicsFocus(null);
            setRelFocusPersonId(pid);
            setKinRole(role);
            setShowAddKin(true);
          }}
          onShowInLineage={() => {
            const pid = selectedPersonId;
            setSelectedPersonId(null);
            setDrawerBasicsFocus(null);
            setTab("lineage");
            setLineageFocusId(pid);
          }}
          onOpenPerson={(id) => {
            setDrawerBasicsFocus(null);
            setSelectedPersonId(id);
          }}
          onOpenSourcesLibrary={(evidenceId) => {
            setSelectedPersonId(null);
            setDrawerBasicsFocus(null);
            setDrawerExternalSeed(null);
            setSourcesFocusEvidenceId(evidenceId);
            setTab("overview");
          }}
          onDeleted={async (name, personId) => {
            setSelectedPersonId(null);
            setDrawerExternalSeed(null);
            setDrawerBasicsFocus(null);
            setError("");
            setPendingUndo({ kind: "person", id: personId, label: name });
            setFlash(
              `已移除「${name}」。误删可点恢复，或稍后在概览「最近动态」找回。`
            );
            setTab("overview");
            await load();
            requestAnimationFrame(() => {
              document
                .getElementById("overview-restorable")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }}
          onRelationshipRemoved={(relationshipId, label) => {
            setError("");
            setPendingUndo({
              kind: "relationship",
              id: relationshipId,
              label,
            });
            setFlash(`已移除${label}。误删可点恢复。`);
          }}
          onEvidenceRemoved={(evidenceId, label) => {
            setError("");
            setPendingUndo({ kind: "evidence", id: evidenceId, label });
            setFlash(`已移除「${label}」。误删可点恢复。`);
          }}
          onEvidenceUnlinked={(args) => {
            setError("");
            setPendingUndo({
              kind: "evidence-link",
              id: `${args.claimId}:${args.evidenceId}`,
              label: args.label,
              claimId: args.claimId,
              evidenceId: args.evidenceId,
              relation: args.relation,
            });
            setFlash(`已取消「${args.label}」的挂接。误取消可点恢复。`);
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
  showGenerations,
  canEdit,
  onAdd,
  onOpen,
}: {
  persons: GraphPerson[];
  generationByPerson: Record<string, number>;
  showGenerations: boolean;
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

  const livingCounts = useMemo(() => {
    const c = { ALL: persons.length, LIVING: 0, DECEASED: 0, UNKNOWN: 0 };
    for (const p of persons) {
      if (p.livingStatus === "LIVING") c.LIVING += 1;
      else if (p.livingStatus === "DECEASED") c.DECEASED += 1;
      else c.UNKNOWN += 1;
    }
    return c;
  }, [persons]);

  const filterActive = Boolean(query.trim()) || livingFilter !== "ALL";

  if (persons.length === 0) {
    return (
      <div className="alpha-panel border-dashed px-5 py-12 text-center">
        <p className="alpha-font-display text-xl font-bold text-[color:var(--a-ink)]">
          还没有家族成员
        </p>
        <p className="mt-2 text-sm text-[color:var(--a-muted)]">
          {canEdit
            ? "先添加你熟悉的一两位家人即可，资料以后可以慢慢补。"
            : "有编辑权限的家人添加成员后，名单会出现在这里。"}
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
              <span className="ml-1 opacity-80">{livingCounts[id]}</span>
            </button>
          ))}
        </div>
      ) : null}
      {filterActive && filtered.length > 0 ? (
        <p className="mb-2 text-sm text-[color:var(--a-muted)]" aria-live="polite">
          显示 {filtered.length} / {persons.length} 位成员
          <button
            type="button"
            className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
            onClick={() => {
              setQuery("");
              setLivingFilter("ALL");
            }}
          >
            清除筛选
          </button>
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[color:var(--a-muted)]">
            {query.trim()
              ? `没有匹配「${query.trim()}」的成员`
              : "没有符合当前筛选的成员"}
          </p>
          {filterActive ? (
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
                      showGenerations && generationByPerson[p.id]
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

/** Above this many members, the lineage opens with only the first generations unfolded. */
const LINEAGE_FOLD_THRESHOLD = 80;
const LINEAGE_OPEN_GENERATIONS = 3;

function LineageTab({
  persons,
  relationships,
  generationByPerson,
  componentCount,
  canEdit,
  focusPersonId,
  onAddRel,
  onAddKin,
  onGoMembers,
  onOpen,
  personMap,
  familyId,
  dataVersion,
}: {
  persons: GraphPerson[];
  relationships: GraphRel[];
  generationByPerson: Record<string, number>;
  componentCount: number;
  canEdit: boolean;
  focusPersonId?: string | null;
  onAddRel: () => void;
  onAddKin: (personId: string, role: KinRole) => void;
  onGoMembers: () => void;
  onOpen: (id: string) => void;
  personMap: Map<string, GraphPerson>;
  familyId: string;
  dataVersion: number;
}) {
  const wordsByPerson = useGenerationWords(
    familyId,
    relationships.length > 0,
    dataVersion
  );
  const wordsByGen = useMemo(
    () => generationWordsByGeneration(wordsByPerson, generationByPerson),
    [wordsByPerson, generationByPerson]
  );
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

  const [query, setQuery] = useState("");
  const [branchRoot, setBranchRoot] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    if (persons.length <= LINEAGE_FOLD_THRESHOLD) return new Set();
    const gens = new Set(Object.values(generationByPerson));
    return new Set([...gens].filter((g) => g > LINEAGE_OPEN_GENERATIONS));
  });
  const [jumpId, setJumpId] = useState<string | null>(null);

  const branchOptions = useMemo(() => {
    const hasChildren = new Set(parentRels.map((r) => r.fromPersonId));
    return persons
      .filter((p) => hasChildren.has(p.id))
      .sort(
        (a, b) =>
          (generationByPerson[a.id] ?? 1) - (generationByPerson[b.id] ?? 1) ||
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
      );
  }, [persons, parentRels, generationByPerson]);

  /** The chosen ancestor, every descendant, and their spouses. */
  const scopedPersons = useMemo(() => {
    if (!branchRoot || !personMap.has(branchRoot)) return persons;
    const keep = new Set<string>([branchRoot]);
    const queue = [branchRoot];
    while (queue.length) {
      const id = queue.shift()!;
      for (const r of parentRels) {
        if (r.fromPersonId === id && !keep.has(r.toPersonId)) {
          keep.add(r.toPersonId);
          queue.push(r.toPersonId);
        }
      }
    }
    for (const r of spouses) {
      if (keep.has(r.fromPersonId)) keep.add(r.toPersonId);
      else if (keep.has(r.toPersonId)) keep.add(r.fromPersonId);
    }
    return persons.filter((p) => keep.has(p.id));
  }, [branchRoot, persons, parentRels, spouses, personMap]);

  const q = query.trim();
  const matches = useMemo(
    () =>
      q
        ? scopedPersons
            .filter((p) => p.preferredName.includes(q))
            .sort(
              (a, b) =>
                (generationByPerson[a.id] ?? 1) -
                  (generationByPerson[b.id] ?? 1) ||
                a.preferredName.localeCompare(b.preferredName, "zh-CN")
            )
        : [],
    [q, scopedPersons, generationByPerson]
  );
  const outsideMatches = useMemo(() => {
    if (!q || !branchRoot || matches.length > 0) return [];
    return persons
      .filter((p) => p.preferredName.includes(q))
      .sort(
        (a, b) =>
          (generationByPerson[a.id] ?? 1) - (generationByPerson[b.id] ?? 1) ||
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
      );
  }, [q, branchRoot, matches.length, persons, generationByPerson]);
  const matchIds = useMemo(() => new Set(matches.map((p) => p.id)), [matches]);

  function jumpTo(id: string) {
    const g = generationByPerson[id] ?? 1;
    setCollapsed((prev) => {
      if (!prev.has(g)) return prev;
      const next = new Set(prev);
      next.delete(g);
      return next;
    });
    setJumpId(id);
  }

  function toggleGen(g: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  /** Per generation: clusters of 1–2 people (spouse pairs kept adjacent). */
  const byGen = useMemo(() => {
    const map = new Map<number, GraphPerson[]>();
    for (const p of scopedPersons) {
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
  }, [scopedPersons, generationByPerson, spouses]);

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
      scrollIntoViewSafe(el, { block: "center" });
      el.focus();
    }
  }, [focusPersonId, byGen]);

  useEffect(() => {
    if (!jumpId) return;
    const el = document.querySelector(`[data-lineage-person="${jumpId}"]`);
    if (el instanceof HTMLElement) {
      scrollIntoViewSafe(el, { block: "center" });
      el.focus();
    }
  }, [jumpId, collapsed, byGen]);

  const allGens = byGen.map(([g]) => g);
  const allCollapsed =
    allGens.length > 0 && allGens.every((g) => collapsed.has(g));
  const highlightId = jumpId ?? focusPersonId;

  const branchReps = useMemo(() => {
    if (componentCount <= 1) return [] as GraphPerson[];
    const sorted = persons
      .slice()
      .sort((a, b) =>
        a.preferredName.localeCompare(b.preferredName, "zh-CN")
      );
    const adj = new Map<string, string[]>();
    for (const p of sorted) adj.set(p.id, []);
    for (const r of relationships) {
      adj.get(r.fromPersonId)?.push(r.toPersonId);
      adj.get(r.toPersonId)?.push(r.fromPersonId);
    }
    const seen = new Set<string>();
    const comps: GraphPerson[][] = [];
    for (const p of sorted) {
      if (seen.has(p.id)) continue;
      const queue = [p];
      seen.add(p.id);
      const comp: GraphPerson[] = [];
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        for (const nid of adj.get(cur.id) ?? []) {
          if (seen.has(nid)) continue;
          seen.add(nid);
          const np = sorted.find((x) => x.id === nid);
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
  }, [componentCount, persons, relationships]);

  return (
    <div>
      {canEdit ? (
        <button
          type="button"
          onClick={persons.length < 2 ? onGoMembers : onAddRel}
          className="alpha-btn alpha-btn-secondary mb-3 !min-h-[44px] !text-sm"
        >
          {persons.length < 2 ? "去添加成员" : "+ 添加家庭关系"}
        </button>
      ) : null}

      {componentCount > 1 ? (
        <div
          className="mb-3 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-3"
          role="region"
          aria-label="尚未连接的家族分支"
        >
          <p className="text-sm text-[color:var(--a-muted)]">
            {canEdit
              ? `档案里有 ${componentCount} 个尚未连接的家族分支。点较小分支里的人名，可为 TA 添加父母或配偶，与主支连上。`
              : `档案里有 ${componentCount} 个尚未连接的家族分支。可先打开较小分支里的人物页；有编辑权限的家人补上关系后，会并入主支。`}
          </p>
          {branchReps.length > 0 ? (
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label={canEdit ? "连接分支" : "查看分支"}
            >
              {branchReps.map((p) =>
                canEdit ? (
                  <button
                    key={p.id}
                    type="button"
                    className="alpha-chip !min-h-[32px] font-semibold"
                    onClick={() => onAddKin(p.id, "parent")}
                  >
                    {p.preferredName}
                  </button>
                ) : (
                  <button
                    key={p.id}
                    type="button"
                    className="alpha-chip !min-h-[32px] font-semibold"
                    onClick={() => onOpen(p.id)}
                  >
                    {p.preferredName}
                  </button>
                )
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {persons.length > 200 ? (
        <p className="mb-3 text-sm text-[color:var(--a-muted)]">
          成员较多时，可用上方查找或「某人一支」缩小范围；超过约 80 人时，较远的世代会默认收起。
        </p>
      ) : null}

      {relationships.length > 0 && persons.length >= 2 ? (
        <div
          role="search"
          aria-label="世系工具"
          className="alpha-panel mb-4 space-y-3 px-3 py-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">在世系中查找</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) {
                    e.preventDefault();
                    jumpTo(matches[0].id);
                  }
                }}
                placeholder="在世系中查找姓名"
                className="alpha-input !min-h-[40px] w-full !text-sm"
              />
            </label>
            {branchOptions.length > 0 ? (
              <label className="sm:w-56">
                <span className="sr-only">查看分支</span>
                <select
                  value={branchRoot ?? ""}
                  onChange={(e) => {
                    setBranchRoot(e.target.value || null);
                    setJumpId(null);
                  }}
                  className="alpha-input !min-h-[40px] w-full !text-sm"
                >
                  <option value="">查看全部世系</option>
                  {branchOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.preferredName}
                      {generationByPerson[p.id]
                        ? `（${generationLabel(generationByPerson[p.id])}）`
                        : ""}
                      一支
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-[color:var(--a-muted)]" aria-live="polite">
              {q
                ? matches.length
                  ? `找到 ${matches.length} 位`
                  : outsideMatches.length
                    ? `当前分支没有「${q}」，全部世系中有 ${outsideMatches.length} 位`
                    : "没有找到这个名字"
                : branchRoot
                  ? `正在查看${personMap.get(branchRoot)?.preferredName ?? ""}一支，共 ${scopedPersons.length} 人`
                  : `共 ${byGen.length} 代 ${persons.length} 人`}
            </p>
            <span className="flex flex-wrap items-center gap-3">
              {q && !matches.length && outsideMatches.length > 0 ? (
                <button
                  type="button"
                  className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setBranchRoot(null);
                    setJumpId(null);
                  }}
                >
                  在全部世系中查找
                </button>
              ) : null}
              {q && !matches.length && outsideMatches.length === 0 ? (
                <button
                  type="button"
                  className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() => setQuery("")}
                >
                  清除查找
                </button>
              ) : null}
              {allGens.length > 1 ? (
                <button
                  type="button"
                  className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(allGens))
                  }
                >
                  {allCollapsed ? "全部展开" : "全部收起"}
                </button>
              ) : null}
            </span>
          </div>
          {matches.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="查找结果">
              {matches.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(p.id)}
                    className="alpha-chip !min-h-[32px] font-semibold"
                  >
                    {p.preferredName}
                    {generationByPerson[p.id]
                      ? ` · ${generationLabel(generationByPerson[p.id])}`
                      : ""}
                  </button>
                </li>
              ))}
              {matches.length > 12 ? (
                <li className="self-center text-xs text-[color:var(--a-muted)]">
                  还有 {matches.length - 12} 位，请输入更完整的名字
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {persons.length === 0 || relationships.length === 0 ? (
        <div className="alpha-panel border-dashed px-4 py-10 text-center">
          <p className="text-[color:var(--a-muted)]">
            {persons.length === 0
              ? "先添加家人，再回来建立关系、按世代查看。"
              : persons.length === 1
                ? "再添加一位家人后，就能建立关系并按世代查看。"
                : "添加家庭关系后，这里会按世代展示。"}
          </p>
          {canEdit ? (
            <button
              type="button"
              className="alpha-btn alpha-btn-primary mt-5"
              onClick={persons.length < 2 ? onGoMembers : onAddRel}
            >
              {persons.length < 2 ? "去添加成员" : "添加家庭关系"}
            </button>
          ) : (
            <p className="mt-3 text-sm text-[color:var(--a-muted)]">
              有编辑权限的家人补充后，世系会出现在这里。
            </p>
          )}
        </div>
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
                  <button
                    type="button"
                    aria-expanded={!collapsed.has(gen)}
                    aria-controls={`lineage-gen-${gen}`}
                    onClick={() => toggleGen(gen)}
                    className="inline-flex items-center gap-1.5 rounded-md hover:underline underline-offset-2"
                  >
                    <span aria-hidden className="inline-block w-3 text-xs">
                      {collapsed.has(gen) ? "▸" : "▾"}
                    </span>
                    {generationLabel(gen)}
                    <span className="font-normal text-[color:var(--a-muted)]">
                      {genCount} 人
                    </span>
                  </button>
                  {wordsByGen.get(gen)?.length ? (
                    <span className="ml-3 font-normal text-[color:var(--a-ink)]">
                      字辈：
                      {wordsByGen
                        .get(gen)!
                        .slice(0, 3)
                        .map((w) => `「${w.word}」`)
                        .join("")}
                    </span>
                  ) : null}
                </h3>
                <ul
                  id={`lineage-gen-${gen}`}
                  hidden={collapsed.has(gen)}
                  className={
                    collapsed.has(gen) ? "hidden" : "flex flex-wrap gap-2"
                  }
                >
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
                                className={`alpha-panel alpha-panel-interactive min-w-[6.75rem] px-2.5 py-1.5 text-left ${
                                  highlightId === p.id
                                    ? "ring-2 ring-[color:var(--a-brand)] ring-offset-1"
                                    : ""
                                } ${
                                  matchIds.has(p.id)
                                    ? "!bg-[color:var(--a-brand-soft)]"
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

/** After saving a vital fact, suggest the natural follow-up type if still missing. */
function nextClaimAfterSave(
  savedType: string,
  presentTypes: string[],
  livingStatus?: string
): string | null {
  const has = (t: string) => presentTypes.includes(t);
  if (savedType === "BIRTH_DATE" && !has("BIRTH_PLACE")) return "BIRTH_PLACE";
  if (savedType === "BIRTH_PLACE" && !has("ANCESTRAL_PLACE"))
    return "ANCESTRAL_PLACE";
  if (savedType === "ANCESTRAL_PLACE" && !has("OCCUPATION"))
    return "OCCUPATION";
  if (savedType === "OCCUPATION" && !has("ALIAS")) return "ALIAS";
  if (savedType === "ALIAS" && !has("STORY")) return "STORY";
  if (
    savedType === "DEATH_DATE" &&
    livingStatus === "DECEASED" &&
    !has("BURIAL_PLACE")
  ) {
    return "BURIAL_PLACE";
  }
  return null;
}

function flashAfterClaimSave(
  followUp: string | null,
  savedType?: string
): string {
  if (followUp === "BIRTH_PLACE") return "已添加出生信息。接着可以记下出生地。";
  if (followUp === "ANCESTRAL_PLACE")
    return "已添加出生地。接着可以记下祖籍。";
  if (followUp === "OCCUPATION") return "已添加祖籍。接着可以记下职业。";
  if (followUp === "ALIAS") return "已添加职业。接着可以记下字号或别名。";
  if (followUp === "STORY")
    return "已添加字号。接着可以记下一段故事或口述。";
  if (followUp === "BURIAL_PLACE")
    return "已添加去世信息。接着可以记下安葬地。";
  if (savedType === "STORY")
    return "已添加故事。接着可以补上口述或谱页来源。";
  if (savedType)
    return "已添加人物资料。接着可以补上谱页或其他来源。";
  return "已添加人物资料。需要的话，可为这条补上来源。";
}

function ClaimStartCtas({
  livingStatus,
  presentTypes = [],
  variant = "start",
  onPick,
}: {
  livingStatus?: string;
  /** Claim types already on this person — SINGLETON chips hide; MULTI stay. */
  presentTypes?: string[];
  variant?: "start" | "more";
  onPick: (claimType: string) => void;
}) {
  const present = new Set(presentTypes);
  const multi = new Set(listMultiClaimTypes());
  const startLabels: Record<string, string> = {
    BIRTH_DATE: "记下出生信息",
    BIRTH_PLACE: "记下出生地",
    ANCESTRAL_PLACE: "记下祖籍",
    GENERATION_WORD: "记下字辈",
    BIRTH_ORDER: "记下排行",
    ALIAS: "记下别名",
    OCCUPATION: "记下职业",
    STORY: "记下故事",
    DEATH_DATE: "记下去世信息",
    BURIAL_PLACE: "记下安葬地",
  };
  const againLabels: Record<string, string> = {
    ANCESTRAL_PLACE: "再记祖籍",
    OCCUPATION: "再记职业",
    ALIAS: "再记别名",
    STORY: "再记故事",
  };
  const types = [
    "BIRTH_DATE",
    "BIRTH_PLACE",
    "ANCESTRAL_PLACE",
    "OCCUPATION",
    "ALIAS",
    "STORY",
    "GENERATION_WORD",
    "BIRTH_ORDER",
    ...(livingStatus === "DECEASED" ? ["DEATH_DATE", "BURIAL_PLACE"] : []),
  ].filter((t) => !present.has(t) || multi.has(t as never));
  if (types.length === 0) return null;

  const items = types.map((type) => ({
    type,
    label: present.has(type)
      ? againLabels[type] ?? `再记${CLAIM_TYPE_UI[type]?.label ?? type}`
      : variant === "more"
        ? CLAIM_TYPE_UI[type]?.label ?? type
        : startLabels[type] ?? type,
  }));

  return (
    <div
      className={
        variant === "more"
          ? "mt-4 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-3"
          : "mt-4"
      }
    >
      {variant === "more" ? (
        <p className="mb-2 text-sm font-semibold text-[color:var(--a-brand)]">
          还可以补充
        </p>
      ) : null}
      <div
        className={`flex flex-wrap gap-2 ${
          variant === "start" ? "justify-center" : ""
        }`}
        role="group"
        aria-label={variant === "more" ? "还可以补充" : "开始记录"}
      >
        {items.map((i) => (
          <button
            key={i.type}
            type="button"
            className={`alpha-btn alpha-btn-secondary ${
              variant === "more"
                ? "!min-h-[36px] !px-3 !text-xs"
                : "!min-h-[40px] !text-sm"
            }`}
            onClick={() => onPick(i.type)}
          >
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecordsTab({
  familyId,
  persons,
  relationships,
  generationByPerson,
  canEdit,
  canReview,
  role,
  claimSeed,
  onClaimSeedConsumed,
  evidenceSeed,
  onEvidenceSeedConsumed,
  recordsFocus,
  onRecordsFocusConsumed,
  onOpenSourcesLibrary,
  onAuthError,
  onOpenPerson,
  onGoMembers,
  setFlash,
  setPendingUndo,
  setError,
  onEvidenceRemoved,
  onEvidenceUnlinked,
}: {
  familyId: string;
  persons: GraphPerson[];
  relationships: GraphRel[];
  generationByPerson: Record<string, number>;
  canEdit: boolean;
  canReview: boolean;
  role: Role;
  claimSeed: { personId: string; claimType: string; nonce: number } | null;
  onClaimSeedConsumed: () => void;
  evidenceSeed: {
    personId: string;
    claimId: string;
    evidenceType?: string;
    nonce: number;
  } | null;
  onEvidenceSeedConsumed: () => void;
  recordsFocus: {
    personId: string;
    claimId: string;
    statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
    nonce: number;
  } | null;
  onRecordsFocusConsumed: () => void;
  onOpenSourcesLibrary?: (evidenceId: string) => void;
  onAuthError: (e: unknown) => boolean;
  onOpenPerson: (id: string) => void;
  onGoMembers: () => void;
  setFlash: (s: string) => void;
  setPendingUndo: (
    undo: null | {
      kind: "claim";
      id: string;
      label: string;
    }
  ) => void;
  setError: (s: string) => void;
  onEvidenceRemoved: (evidenceId: string, label: string) => void;
  onEvidenceUnlinked: (args: {
    claimId: string;
    evidenceId: string;
    relation: string;
    label: string;
  }) => void;
}) {
  const [personId, setPersonId] = useState("");
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [localSeed, setLocalSeed] = useState<{
    claimType: string;
    nonce: number;
  } | null>(null);
  const [openEvidenceClaimId, setOpenEvidenceClaimId] = useState<string | null>(
    null
  );
  const [openEvidenceType, setOpenEvidenceType] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PROPOSED" | "ACCEPTED" | "CONFLICTED"
  >("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const personReady = useRef(false);

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
    personReady.current = false;
    if (persons.length === 0) {
      setPersonId("");
      return;
    }
    setPersonId((current) => {
      if (current && persons.some((p) => p.id === current)) return current;
      let preferred = "";
      try {
        preferred =
          sessionStorage.getItem(`alpha-records-person:${familyId}`) ?? "";
      } catch {
        preferred = "";
      }
      if (preferred && persons.some((p) => p.id === preferred)) return preferred;
      return persons[0].id;
    });
  }, [familyId, persons]);

  useEffect(() => {
    if (!personId || !persons.some((p) => p.id === personId)) return;
    if (!personReady.current) {
      personReady.current = true;
      return;
    }
    try {
      sessionStorage.setItem(`alpha-records-person:${familyId}`, personId);
    } catch {
      /* private mode */
    }
  }, [familyId, personId, persons]);

  useEffect(() => {
    if (!personId || !topRef.current) return;
    scrollIntoViewSafe(topRef.current, { block: "nearest" });
  }, [personId]);

  const pendingStatusFilter = useRef<
    "PROPOSED" | "CONFLICTED" | "ALL" | null
  >(null);

  useEffect(() => {
    if (pendingStatusFilter.current) {
      setStatusFilter(pendingStatusFilter.current);
      pendingStatusFilter.current = null;
    } else {
      setStatusFilter("ALL");
    }
    setTypeFilter("ALL");
  }, [personId]);

  useEffect(() => {
    if (!claimSeed) return;
    if (persons.some((p) => p.id === claimSeed.personId)) {
      setPersonId(claimSeed.personId);
      setLocalSeed({
        claimType: claimSeed.claimType,
        nonce: claimSeed.nonce,
      });
    }
  }, [claimSeed, persons]);

  useEffect(() => {
    if (!evidenceSeed) return;
    if (persons.some((p) => p.id === evidenceSeed.personId)) {
      setPersonId(evidenceSeed.personId);
      setOpenEvidenceClaimId(evidenceSeed.claimId);
      setOpenEvidenceType(evidenceSeed.evidenceType ?? null);
      onEvidenceSeedConsumed();
    }
  }, [evidenceSeed, persons, onEvidenceSeedConsumed]);

  useEffect(() => {
    if (!openEvidenceClaimId || loading) return;
    const el = document.querySelector(
      `[data-claim-id="${openEvidenceClaimId}"]`
    );
    if (el instanceof HTMLElement) {
      scrollIntoViewSafe(el, { block: "center" });
    }
  }, [openEvidenceClaimId, loading, claims]);

  useEffect(() => {
    if (!recordsFocus) return;
    if (recordsFocus.statusFilter) {
      pendingStatusFilter.current = recordsFocus.statusFilter;
    }
    if (persons.some((p) => p.id === recordsFocus.personId)) {
      setPersonId(recordsFocus.personId);
    }
  }, [recordsFocus, persons]);

  useEffect(() => {
    if (!recordsFocus || loading) return;
    if (personId !== recordsFocus.personId) return;
    const focused = claims.find((c) => c.id === recordsFocus.claimId);
    if (!focused) return;
    const claimId = recordsFocus.claimId;
    if (focused.status === "REJECTED") {
      setStatusFilter("ALL");
      setRejectedOpen(true);
    } else if (focused.status === "PROPOSED") {
      setStatusFilter(
        recordsFocus.statusFilter === "PROPOSED" ? "PROPOSED" : "ALL"
      );
    } else if (focused.status === "CONFLICTED") {
      setStatusFilter("CONFLICTED");
    } else if (recordsFocus.statusFilter) {
      setStatusFilter(recordsFocus.statusFilter);
    } else {
      setStatusFilter("ALL");
    }
    onRecordsFocusConsumed();
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-claim-id="${claimId}"]`);
      if (el instanceof HTMLElement) {
        scrollIntoViewSafe(el, { block: "center" });
        el.classList.add("ring-2", "ring-[color:var(--a-brand)]");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-[color:var(--a-brand)]");
        }, 2400);
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [
    recordsFocus,
    onRecordsFocusConsumed,
    claims,
    loading,
    personId,
  ]);

  const active = claims.filter((c) => c.status !== "REJECTED");
  const selectedPerson = persons.find((p) => p.id === personId);
  const rejected = claims.filter((c) => c.status === "REJECTED");
  const proposedCount = active.filter((c) => c.status === "PROPOSED").length;
  const acceptedCount = active.filter((c) => c.status === "ACCEPTED").length;
  const conflictedCount = active.filter(
    (c) => c.status === "CONFLICTED"
  ).length;
  const claimTypesPresent = useMemo(() => {
    const types = [...new Set(active.map((c) => c.claimType))];
    types.sort((a, b) =>
      (CLAIM_TYPE_UI[a]?.label ?? a).localeCompare(
        CLAIM_TYPE_UI[b]?.label ?? b,
        "zh-CN"
      )
    );
    return types;
  }, [active]);

  const filteredActive = useMemo(() => {
    let rows = active;
    if (statusFilter !== "ALL") {
      rows = rows.filter((c) => c.status === statusFilter);
    }
    if (typeFilter !== "ALL") {
      rows = rows.filter((c) => c.claimType === typeFilter);
    }
    return rows;
  }, [active, statusFilter, typeFilter]);

  const filtersActive = statusFilter !== "ALL" || typeFilter !== "ALL";

  const grouped = useMemo(() => {
    const m = new Map<string, ClaimRow[]>();
    for (const c of filteredActive) {
      if (!m.has(c.claimType)) m.set(c.claimType, []);
      m.get(c.claimType)!.push(c);
    }
    return m;
  }, [filteredActive]);

  const personIndex = sortedPersons.findIndex((p) => p.id === personId);
  const prevPerson =
    personIndex > 0 ? sortedPersons[personIndex - 1] : null;
  const nextPerson =
    personIndex >= 0 && personIndex < sortedPersons.length - 1
      ? sortedPersons[personIndex + 1]
      : null;

  if (persons.length === 0) {
    return (
      <div className="alpha-panel border-dashed px-5 py-12 text-center">
        <p className="alpha-font-display text-xl font-bold text-[color:var(--a-ink)]">
          还没有可记录的成员
        </p>
        <p className="mt-2 text-sm text-[color:var(--a-muted)]">
          {canEdit
            ? "先在「成员」里添加家人，再回来写下我们知道的事。"
            : "有编辑权限的家人添加成员后，这里才能记录资料。"}
        </p>
        {canEdit ? (
          <button
            type="button"
            className="alpha-btn alpha-btn-primary mt-6"
            onClick={onGoMembers}
          >
            去添加成员
          </button>
        ) : null}
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary !min-h-[44px] !px-3 !text-sm"
            disabled={!prevPerson}
            onClick={() => prevPerson && setPersonId(prevPerson.id)}
            aria-label={
              prevPerson ? `上一位：${prevPerson.preferredName}` : "没有上一位"
            }
          >
            上一位
          </button>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary !min-h-[44px] !px-3 !text-sm"
            disabled={!nextPerson}
            onClick={() => nextPerson && setPersonId(nextPerson.id)}
            aria-label={
              nextPerson ? `下一位：${nextPerson.preferredName}` : "没有下一位"
            }
          >
            下一位
          </button>
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
      </div>

      {canEdit && personId ? (
        <AddClaimForm
          familyId={familyId}
          personId={personId}
          canReview={canReview}
          compact
          generationByPerson={generationByPerson}
          relationships={relationships}
          persons={persons}
          seedClaimType={localSeed?.claimType ?? null}
          seedNonce={localSeed?.nonce ?? null}
          onSeedConsumed={() => {
            setLocalSeed(null);
            onClaimSeedConsumed();
          }}
          onAuthError={onAuthError}
          onDone={async ({ claimType: savedType, claimId }) => {
            const followUp = nextClaimAfterSave(
              savedType,
              active.map((c) => c.claimType),
              selectedPerson?.livingStatus
            );
            setFlash(flashAfterClaimSave(followUp, savedType));
            setStatusFilter("ALL");
            await loadClaims();
            if (followUp) {
              setLocalSeed({ claimType: followUp, nonce: Date.now() });
            } else {
              setOpenEvidenceClaimId(claimId);
            }
          }}
          onError={setError}
        />
      ) : null}

      {active.length > 0 ? (
        <div className="mb-4 space-y-2">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="按资料状态筛选"
          >
            {(
              [
                ["ALL", "全部", active.length],
                ["PROPOSED", "待确认", proposedCount],
                ["ACCEPTED", "已确认", acceptedCount],
                ["CONFLICTED", "不同说法", conflictedCount],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                aria-pressed={statusFilter === id}
                onClick={() => setStatusFilter(id)}
                className={`alpha-btn !min-h-[36px] !px-3 !text-xs ${
                  statusFilter === id
                    ? "alpha-btn-primary"
                    : "alpha-btn-secondary"
                }`}
              >
                {label}
                {` ${count}`}
              </button>
            ))}
          </div>
          {claimTypesPresent.length > 1 ? (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="按资料类型筛选"
            >
              <button
                type="button"
                aria-pressed={typeFilter === "ALL"}
                onClick={() => setTypeFilter("ALL")}
                className={`alpha-btn !min-h-[36px] !px-3 !text-xs ${
                  typeFilter === "ALL"
                    ? "alpha-btn-primary"
                    : "alpha-btn-secondary"
                }`}
              >
                全部类型 {active.length}
              </button>
              {claimTypesPresent.map((t) => {
                const count = active.filter((c) => c.claimType === t).length;
                const label = CLAIM_TYPE_UI[t]?.label ?? t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    className={`alpha-btn !min-h-[36px] !px-3 !text-xs ${
                      typeFilter === t
                        ? "alpha-btn-primary"
                        : "alpha-btn-secondary"
                    }`}
                  >
                    {label} {count}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {filtersActive && filteredActive.length > 0 ? (
        <p className="mb-3 text-sm text-[color:var(--a-muted)]" aria-live="polite">
          显示 {filteredActive.length} / {active.length} 条资料
          <button
            type="button"
            className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
            onClick={() => {
              setStatusFilter("ALL");
              setTypeFilter("ALL");
            }}
          >
            清除筛选
          </button>
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[color:var(--a-muted)]" role="status">
          正在读取人物资料…
        </p>
      ) : null}

      {[...grouped.entries()].map(([type, rows]) => {
        const conflicted = rows.filter((r) => r.status === "CONFLICTED");
        const others = rows.filter((r) => r.status !== "CONFLICTED");
        const label = CLAIM_TYPE_UI[type]?.label ?? type;
        const showChooser = conflicted.length >= 2;
        const listRows = showChooser ? others : rows;
        return (
          <section
            key={type}
            className="mb-4 rounded-2xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] p-4"
          >
            <h3 className="font-bold text-[color:var(--a-ink)]">{label}</h3>
            {showChooser ? (
              <ConflictChooser
                familyId={familyId}
                claims={conflicted}
                canReview={canReview}
                canEdit={canEdit}
                onChanged={loadClaims}
                onError={setError}
                onFlash={(msg, undoClaimId) => {
                  setFlash(msg);
                  setPendingUndo(
                    undoClaimId
                      ? {
                          kind: "claim",
                          id: undoClaimId,
                          label: "这条资料",
                        }
                      : null
                  );
                }}
                onAuthError={onAuthError}
                onOpenEvidenceAfterAccept={(id) => {
                  setStatusFilter("ALL");
                  setOpenEvidenceClaimId(id);
                  setOpenEvidenceType(null);
                }}
              />
            ) : null}
            {listRows.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {listRows.map((c) => (
                  <ClaimCard
                    key={c.id}
                    familyId={familyId}
                    claim={c}
                    canEdit={canEdit}
                    canReview={canReview}
                    autoOpenEvidence={openEvidenceClaimId === c.id}
                    seedEvidenceType={
                      openEvidenceClaimId === c.id ? openEvidenceType : null
                    }
                    onAutoOpenEvidenceConsumed={() => {
                      setOpenEvidenceClaimId(null);
                      setOpenEvidenceType(null);
                    }}
                    onOpenEvidenceAfterAccept={(id) => {
                      setStatusFilter("ALL");
                      setOpenEvidenceClaimId(id);
                      setOpenEvidenceType(null);
                    }}
                    onProposeAlternate={(claimType) => {
                      setStatusFilter("ALL");
                      setLocalSeed({ claimType, nonce: Date.now() });
                    }}
                    onOpenSourcesLibrary={onOpenSourcesLibrary}
                    onAuthError={onAuthError}
                    onChanged={loadClaims}
                    onError={setError}
                    onFlash={(msg, undoClaimId) => {
                      setFlash(msg);
                      setPendingUndo(
                        undoClaimId
                          ? {
                              kind: "claim",
                              id: undoClaimId,
                              label: "这条资料",
                            }
                          : null
                      );
                    }}
                    onEvidenceRemoved={onEvidenceRemoved}
                    onEvidenceUnlinked={onEvidenceUnlinked}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      {rejected.length > 0 ? (
        <details
          data-rejected-claims
          open={rejectedOpen}
          onToggle={(e) => setRejectedOpen(e.currentTarget.open)}
          className="mt-4 rounded-xl border border-[color:var(--a-brand-line)]/25 bg-[color:var(--a-surface)] p-3"
        >
          <summary className="cursor-pointer font-semibold text-[color:var(--a-muted)]">
            查看不采用的记录（{rejected.length}）
          </summary>
          <ul className="mt-2 space-y-2 text-sm text-[color:var(--a-muted)]">
            {rejected.map((c) => (
              <li
                key={c.id}
                data-claim-id={c.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-1 py-0.5"
              >
                <span>
                  {CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType}：
                  {c.value?.text ?? "—"}（不采用）
                </span>
                {canReview ? (
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={async () => {
                      try {
                        await v1api.reopenClaim(familyId, c.id, {
                          idempotencyKey: crypto.randomUUID(),
                        });
                        setFlash("已重新打开这条资料，可再次确认或不采用");
                        setRejectedOpen(false);
                        setStatusFilter("PROPOSED");
                        await loadClaims();
                      } catch (e) {
                        if (onAuthError(e)) return;
                        setError(userMessageForApiError(e));
                      }
                    }}
                  >
                    恢复待确认
                  </button>
                ) : null}
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
          {canEdit ? (
            <ClaimStartCtas
              livingStatus={selectedPerson?.livingStatus}
              onPick={(claimType) =>
                setLocalSeed({ claimType, nonce: Date.now() })
              }
            />
          ) : null}
        </div>
      ) : null}

      {!loading && active.length > 0 && canEdit ? (
        <ClaimStartCtas
          variant="more"
          livingStatus={selectedPerson?.livingStatus}
          presentTypes={[...new Set(active.map((c) => c.claimType))]}
          onPick={(claimType) =>
            setLocalSeed({ claimType, nonce: Date.now() })
          }
        />
      ) : null}

      {!loading &&
      active.length > 0 &&
      filteredActive.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[color:var(--a-muted)]">
            没有符合当前筛选的资料
          </p>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary mt-4 !min-h-[40px] !text-sm"
            onClick={() => {
              setStatusFilter("ALL");
              setTypeFilter("ALL");
            }}
          >
            查看全部
          </button>
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
  generationByPerson,
  relationships = [],
  persons = [],
  seedClaimType = null,
  seedNonce = null,
  onSeedConsumed,
}: {
  familyId: string;
  personId: string;
  canReview: boolean;
  onDone: (saved: {
    claimType: string;
    claimId: string;
  }) => Promise<void>;
  onError: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
  /** On mobile-first surfaces, start collapsed to reduce density. */
  compact?: boolean;
  /** Enables 字辈 suggestions from the same generation. */
  generationByPerson?: Record<string, number>;
  relationships?: GraphRel[];
  persons?: GraphPerson[];
  seedClaimType?: string | null;
  seedNonce?: number | null;
  onSeedConsumed?: () => void;
}) {
  const [claimType, setClaimType] = useState("BIRTH_DATE");
  const [text, setText] = useState("");
  const [narrator, setNarrator] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);
  const [localError, setLocalError] = useState("");
  const [generationSong, setGenerationSong] = useState("");
  const [showSongEditor, setShowSongEditor] = useState(false);
  const textRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isStory = claimType === "STORY";
  const wantWords = Boolean(generationByPerson) && claimType === "GENERATION_WORD";
  const wantOrders = claimType === "BIRTH_ORDER";
  const wordsByPerson = useGenerationWords(familyId, wantWords);
  const birthOrders = useBirthOrders(familyId, wantOrders);
  const myGeneration = generationByPerson?.[personId];
  const peerWords = useMemo(() => {
    if (!wantWords || !generationByPerson || !myGeneration) return [];
    return (
      generationWordsByGeneration(
        wordsByPerson,
        generationByPerson,
        personId
      ).get(myGeneration) ?? []
    );
  }, [wantWords, wordsByPerson, generationByPerson, myGeneration, personId]);
  const peerOrders = useMemo(() => {
    if (!wantOrders) return [] as Array<{ order: string; name: string }>;
    const nameById = new Map(persons.map((p) => [p.id, p.preferredName]));
    return siblingIdsForPerson(personId, relationships)
      .map((id) => {
        const order = birthOrders[id];
        const name = nameById.get(id);
        if (!order || !name) return null;
        return { order, name };
      })
      .filter((x): x is { order: string; name: string } => Boolean(x))
      .sort(
        (a, b) =>
          (birthOrderRank(a.order) ?? 99) - (birthOrderRank(b.order) ?? 99) ||
          a.name.localeCompare(b.name, "zh-CN")
      );
  }, [wantOrders, personId, relationships, persons, birthOrders]);
  const orderQuickPicks = useMemo(() => {
    if (!wantOrders) return [] as string[];
    const used = new Set(peerOrders.map((p) => p.order.trim()));
    return ["长", "次", "三", "四"].filter((o) => !used.has(o));
  }, [wantOrders, peerOrders]);
  const songChars = useMemo(
    () => generationSongChars(generationSong),
    [generationSong]
  );

  useEffect(() => {
    if (claimType !== "GENERATION_WORD") return;
    try {
      setGenerationSong(
        localStorage.getItem(`alpha-generation-song:${familyId}`) ?? ""
      );
    } catch {
      setGenerationSong("");
    }
  }, [claimType, familyId]);

  useEffect(() => {
    if (claimType !== "GENERATION_WORD") return;
    try {
      if (generationSong.trim()) {
        localStorage.setItem(
          `alpha-generation-song:${familyId}`,
          generationSong
        );
      } else {
        localStorage.removeItem(`alpha-generation-song:${familyId}`);
      }
    } catch {
      /* private mode */
    }
  }, [claimType, familyId, generationSong]);

  useEffect(() => {
    setLocalError("");
    setText("");
    setNarrator("");
    setClaimType("BIRTH_DATE");
    if (compact) setOpen(false);
  }, [personId, compact]);

  useEffect(() => {
    if (!seedClaimType || seedNonce == null) return;
    setClaimType(seedClaimType);
    setOpen(true);
    onSeedConsumed?.();
  }, [seedClaimType, seedNonce, onSeedConsumed]);

  useEffect(() => {
    if (open) textRef.current?.focus();
  }, [open, claimType]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      const created = await v1api.createClaim(familyId, {
        subjectId: personId,
        claimType,
        value: isStory
          ? {
              text: text.trim(),
              narrator: narrator.trim() || null,
            }
          : { text: text.trim() },
      });
      const savedType = claimType;
      const claimId = created.claim.id;
      setText("");
      setNarrator("");
      if (compact) setOpen(false);
      await onDone({ claimType: savedType, claimId });
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
            {isStory ? "故事内容" : CLAIM_TYPE_UI[claimType]?.label ?? "内容"}
          </label>
          {isStory ? (
            <textarea
              ref={textRef as RefObject<HTMLTextAreaElement>}
              id="claim-text"
              required
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={CLAIM_TYPE_UI.STORY.placeholder}
              className="alpha-input !min-h-[8rem] resize-y !py-2"
              maxLength={8000}
            />
          ) : (
            <input
              ref={textRef as RefObject<HTMLInputElement>}
              id="claim-text"
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={CLAIM_TYPE_UI[claimType]?.placeholder}
              className="alpha-input"
            />
          )}
          {isStory ? (
            <div className="mt-3">
              <label htmlFor="claim-narrator" className="alpha-label">
                讲述者（可选）
              </label>
              <input
                id="claim-narrator"
                value={narrator}
                onChange={(e) => setNarrator(e.target.value)}
                placeholder="例如：张奶奶口述"
                className="alpha-input"
                maxLength={80}
              />
              <p className="mt-1 text-xs text-[color:var(--a-muted)]">
                记下是谁讲的，方便后人知道出处。
              </p>
            </div>
          ) : null}
          {peerWords.length > 0 ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 text-sm"
              role="group"
              aria-label="同辈字辈"
            >
              <span className="text-[color:var(--a-muted)]">
                同辈已记录：
              </span>
              {peerWords.slice(0, 4).map((w) => (
                <button
                  key={w.word}
                  type="button"
                  onClick={() => {
                    setText(w.word);
                    textRef.current?.focus();
                  }}
                  className="alpha-chip !min-h-[32px] font-semibold"
                >
                  {w.word}
                  <span className="ml-1 font-normal text-[color:var(--a-muted)]">
                    {w.count} 人
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {peerOrders.length > 0 ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 text-sm"
              role="group"
              aria-label="同辈已记排行"
            >
              <span className="text-[color:var(--a-muted)]">
                同辈已记排行：
              </span>
              {peerOrders.slice(0, 6).map((p) => (
                <button
                  key={`${p.name}-${p.order}`}
                  type="button"
                  onClick={() => {
                    setText(p.order);
                    textRef.current?.focus();
                  }}
                  className="alpha-chip !min-h-[32px] font-semibold"
                >
                  {p.order}
                  <span className="ml-1 font-normal text-[color:var(--a-muted)]">
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {wantOrders && orderQuickPicks.length > 0 ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 text-sm"
              role="group"
              aria-label="常用排行"
            >
              <span className="text-[color:var(--a-muted)]">常用：</span>
              {orderQuickPicks.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    setText(o);
                    textRef.current?.focus();
                  }}
                  className="alpha-chip !min-h-[32px] font-semibold"
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          {claimType === "GENERATION_WORD" ? (
            <div className="mt-3 space-y-2">
              {songChars.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-2 text-sm"
                  role="group"
                  aria-label="行辈歌字"
                >
                  <span className="text-[color:var(--a-muted)]">行辈歌：</span>
                  {songChars.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => {
                        setText(ch);
                        textRef.current?.focus();
                      }}
                      className="alpha-chip !min-h-[32px] font-semibold"
                    >
                      {ch}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => setShowSongEditor((v) => !v)}
                  >
                    {showSongEditor ? "收起行辈歌" : "改行辈歌"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() => setShowSongEditor(true)}
                >
                  粘贴行辈歌，从中取一字
                </button>
              )}
              {showSongEditor || songChars.length === 0 ? (
                <div>
                  <label htmlFor="generation-song" className="alpha-label">
                    行辈歌（可选）
                  </label>
                  <textarea
                    id="generation-song"
                    rows={2}
                    value={generationSong}
                    onChange={(e) => {
                      setGenerationSong(e.target.value);
                      setShowSongEditor(true);
                    }}
                    placeholder="例如：圣世长清，兆锡嘉名"
                    className="alpha-input !min-h-[3.5rem] resize-y !py-2"
                    maxLength={400}
                  />
                  <p className="mt-1 text-xs text-[color:var(--a-muted)]">
                    只保存在本机，方便从歌里点选字辈。
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
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

function ConflictChooser({
  familyId,
  claims,
  canReview,
  canEdit,
  onChanged,
  onError,
  onFlash,
  onAuthError,
  onOpenEvidenceAfterAccept,
}: {
  familyId: string;
  claims: ClaimRow[];
  canReview: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onError: (s: string) => void;
  onFlash: (s: string, undoClaimId?: string) => void;
  onAuthError: (e: unknown) => boolean;
  onOpenEvidenceAfterAccept?: (claimId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function prefer(claim: ClaimRow) {
    if (!canReview || busyId) return;
    setBusyId(claim.id);
    try {
      await v1api.preferClaim(familyId, claim.id, {
        idempotencyKey: crypto.randomUUID(),
      });
      let unsourced = true;
      try {
        const b = await v1api.getClaim(familyId, claim.id);
        unsourced = !(b.evidenceLinks?.length > 0);
      } catch {
        /* treat as unsourced if refresh fails */
      }
      onFlash(
        unsourced && canEdit
          ? "已采用这条说法。接着可以补上谱页或其他来源。"
          : "已采用这条说法"
      );
      await onChanged();
      if (unsourced && canEdit) onOpenEvidenceAfterAccept?.(claim.id);
    } catch (e) {
      if (onAuthError(e)) return;
      onError(userMessageForApiError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(claim: ClaimRow) {
    if (!canReview || busyId) return;
    setBusyId(claim.id);
    try {
      await v1api.rejectClaim(familyId, claim.id, {
        idempotencyKey: crypto.randomUUID(),
      });
      onFlash("已处理不同说法。误标可点恢复。", claim.id);
      await onChanged();
    } catch (e) {
      if (onAuthError(e)) return;
      onError(userMessageForApiError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="mt-2 rounded-xl bg-[color:var(--a-warn-soft)] px-3 py-3 ring-1 ring-[color:var(--a-brand-line)]"
      data-conflict-chooser
    >
      <p className="font-semibold text-[color:var(--a-brand)]">存在不同说法</p>
      <p className="mt-1 text-sm text-[color:var(--a-muted)]">
        {canReview
          ? "请选用一种说法作为正式记载，或标记不采用。"
          : "目前资料中记录不一致，需管理员选用一种说法。"}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {claims.map((c, i) => {
          const originLabel =
            c.originType === "AI_EXTRACTION" || c.originType === "IMPORT"
              ? CLAIM_ORIGIN_LABEL[
                  c.originType as keyof typeof CLAIM_ORIGIN_LABEL
                ]
              : null;
          return (
            <li
              key={c.id}
              data-claim-id={c.id}
              className="rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] p-3"
            >
              <p className="text-xs font-semibold text-[color:var(--a-muted)]">
                说法 {i + 1}
                {originLabel ? ` · ${originLabel}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-base font-semibold text-[color:var(--a-ink)]">
                {c.value?.text ?? "—"}
              </p>
              {c.value?.narrator ? (
                <p className="mt-1 text-sm text-[color:var(--a-muted)]">
                  讲述：{c.value.narrator}
                </p>
              ) : null}
              {canReview ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    className="alpha-btn alpha-btn-primary !min-h-[36px] !px-3 !text-xs disabled:opacity-60"
                    onClick={() => void prefer(c)}
                  >
                    {busyId === c.id ? "处理中…" : "采用这条"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs disabled:opacity-60"
                    onClick={() => void reject(c)}
                  >
                    不采用
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClaimCard({
  familyId,
  claim,
  canEdit,
  canReview,
  autoOpenEvidence = false,
  seedEvidenceType = null,
  onAutoOpenEvidenceConsumed,
  onOpenEvidenceAfterAccept,
  onProposeAlternate,
  onOpenSourcesLibrary,
  onChanged,
  onError,
  onFlash,
  onEvidenceRemoved,
  onEvidenceUnlinked,
  onAuthError,
}: {
  familyId: string;
  claim: ClaimRow;
  canEdit: boolean;
  canReview: boolean;
  autoOpenEvidence?: boolean;
  seedEvidenceType?: string | null;
  onAutoOpenEvidenceConsumed?: () => void;
  onOpenEvidenceAfterAccept?: (claimId: string) => void;
  /** Seed composer for a different SINGLETON saying. */
  onProposeAlternate?: (claimType: string) => void;
  onOpenSourcesLibrary?: (evidenceId: string) => void;
  onChanged: () => Promise<void>;
  onError: (s: string) => void;
  onFlash: (s: string, undoClaimId?: string) => void;
  onEvidenceRemoved?: (evidenceId: string, label: string) => void;
  onEvidenceUnlinked?: (args: {
    claimId: string;
    evidenceId: string;
    relation: string;
    label: string;
  }) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [bundle, setBundle] = useState<Awaited<
    ReturnType<typeof v1api.getClaim>
  > | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [forcedEvidenceType, setForcedEvidenceType] = useState<string | null>(
    null
  );
  const [removingEvidenceId, setRemovingEvidenceId] = useState<string | null>(
    null
  );
  const [removingEvidenceShared, setRemovingEvidenceShared] = useState(0);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [evidenceDetailId, setEvidenceDetailId] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

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

  useEffect(() => {
    if (!autoOpenEvidence || !canEdit) return;
    if (seedEvidenceType) setForcedEvidenceType(seedEvidenceType);
    setShowEvidence(true);
    onAutoOpenEvidenceConsumed?.();
  }, [autoOpenEvidence, canEdit, seedEvidenceType, onAutoOpenEvidenceConsumed]);

  const statusLabel =
    CLAIM_STATUS_LABEL[claim.status as keyof typeof CLAIM_STATUS_LABEL] ??
    claim.status;
  const originLabel =
    claim.originType === "AI_EXTRACTION" || claim.originType === "IMPORT"
      ? CLAIM_ORIGIN_LABEL[
          claim.originType as keyof typeof CLAIM_ORIGIN_LABEL
        ]
      : null;
  const statusChip =
    claim.status === "ACCEPTED"
      ? "alpha-chip alpha-chip-accepted"
      : claim.status === "CONFLICTED"
        ? "alpha-chip alpha-chip-conflicted"
        : claim.status === "REJECTED"
          ? "alpha-chip alpha-chip-rejected"
          : "alpha-chip alpha-chip-proposed";

  return (
    <li className="alpha-panel p-3" data-claim-id={claim.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {claim.claimType === "STORY" ? (
            <p className="mb-1 text-xs font-semibold tracking-wide text-[color:var(--a-brand)]">
              故事 / 口述
            </p>
          ) : null}
          <p
            className={`text-base font-semibold text-[color:var(--a-ink)] ${
              claim.claimType === "STORY" ? "whitespace-pre-wrap font-normal leading-relaxed" : ""
            }`}
          >
            {claim.value?.text ?? "—"}
          </p>
          {claim.value?.narrator ? (
            <p className="mt-1 text-sm text-[color:var(--a-muted)]">
              讲述：{claim.value.narrator}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap gap-2">
            {originLabel ? (
              <span className="alpha-chip alpha-chip-proposed">{originLabel}</span>
            ) : null}
            <span className={statusChip}>{statusLabel}</span>
          </p>
        </div>
        {canReview && claim.status === "PROPOSED" ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reviewBusy}
              className="alpha-btn alpha-btn-primary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                if (reviewBusy) return;
                setReviewBusy(true);
                try {
                  await v1api.acceptClaim(familyId, claim.id, {
                    idempotencyKey: crypto.randomUUID(),
                  });
                  let unsourced = true;
                  try {
                    const b = await v1api.getClaim(familyId, claim.id);
                    setBundle(b);
                    unsourced = !(b.evidenceLinks?.length > 0);
                  } catch {
                    /* still treat as unsourced if refresh fails */
                  }
                  onFlash(
                    unsourced && canEdit
                      ? "已确认这条资料。接着可以补上谱页或其他来源。"
                      : "已确认这条资料"
                  );
                  await onChanged();
                  if (unsourced && canEdit) {
                    onOpenEvidenceAfterAccept?.(claim.id);
                  }
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                } finally {
                  setReviewBusy(false);
                }
              }}
            >
              确认这条资料
            </button>
            <button
              type="button"
              disabled={reviewBusy}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                if (reviewBusy) return;
                setReviewBusy(true);
                try {
                  await v1api.rejectClaim(familyId, claim.id, {
                    idempotencyKey: crypto.randomUUID(),
                  });
                  onFlash("已标记为不采用。误标可点恢复。", claim.id);
                  await onChanged();
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                } finally {
                  setReviewBusy(false);
                }
              }}
            >
              不采用
            </button>
          </div>
        ) : null}
        {canReview && claim.status === "CONFLICTED" ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reviewBusy}
              className="alpha-btn alpha-btn-primary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                if (reviewBusy) return;
                setReviewBusy(true);
                try {
                  await v1api.preferClaim(familyId, claim.id, {
                    idempotencyKey: crypto.randomUUID(),
                  });
                  let unsourced = true;
                  try {
                    const b = await v1api.getClaim(familyId, claim.id);
                    setBundle(b);
                    unsourced = !(b.evidenceLinks?.length > 0);
                  } catch {
                    /* treat as unsourced if refresh fails */
                  }
                  onFlash(
                    unsourced && canEdit
                      ? "已采用这条说法。接着可以补上谱页或其他来源。"
                      : "已采用这条说法"
                  );
                  await onChanged();
                  if (unsourced && canEdit) {
                    onOpenEvidenceAfterAccept?.(claim.id);
                  }
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                } finally {
                  setReviewBusy(false);
                }
              }}
            >
              采用这条
            </button>
            <button
              type="button"
              disabled={reviewBusy}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
              onClick={async () => {
                if (reviewBusy) return;
                setReviewBusy(true);
                try {
                  await v1api.rejectClaim(familyId, claim.id, {
                    idempotencyKey: crypto.randomUUID(),
                  });
                  onFlash("已处理不同说法。误标可点恢复。", claim.id);
                  await onChanged();
                } catch (e) {
                  if (onAuthError(e)) return;
                  onError(userMessageForApiError(e));
                } finally {
                  setReviewBusy(false);
                }
              }}
            >
              不采用
            </button>
          </div>
        ) : null}
        {claim.status === "ACCEPTED" ? (
          <div className="flex flex-wrap gap-2">
            {canEdit &&
            onProposeAlternate &&
            !new Set(listMultiClaimTypes() as readonly string[]).has(
              claim.claimType
            ) ? (
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
                onClick={() => onProposeAlternate(claim.claimType)}
              >
                记下另一种说法
              </button>
            ) : null}
            {canReview ? (
              <button
                type="button"
                disabled={reviewBusy}
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
                onClick={async () => {
                  if (reviewBusy) return;
                  setReviewBusy(true);
                  try {
                    await v1api.rejectClaim(familyId, claim.id, {
                      idempotencyKey: crypto.randomUUID(),
                    });
                    onFlash("已标记为不采用。误标可点恢复。", claim.id);
                    await onChanged();
                  } catch (e) {
                    if (onAuthError(e)) return;
                    onError(userMessageForApiError(e));
                  } finally {
                    setReviewBusy(false);
                  }
                }}
              >
                不采用
              </button>
            ) : null}
          </div>
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
                <div>
                  <span className="font-semibold text-[color:var(--a-ink)]">
                    {EVIDENCE_TYPE_UI[l.evidence.evidenceType] ?? "来源"}
                  </span>
                  {l.evidence.title ? ` · ${l.evidence.title}` : ""}
                  {l.evidence.sourceLocator
                    ? ` · ${l.evidence.sourceLocator}`
                    : ""}
                  {l.evidence.description || l.evidence.sourceDateText ? (
                    <button
                      type="button"
                      className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                      aria-expanded={evidenceDetailId === l.evidence.id}
                      onClick={() =>
                        setEvidenceDetailId((id) =>
                          id === l.evidence.id ? null : l.evidence.id
                        )
                      }
                    >
                      详情
                    </button>
                  ) : null}
                  {onOpenSourcesLibrary ? (
                    <button
                      type="button"
                      className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                      onClick={() => onOpenSourcesLibrary(l.evidence.id)}
                    >
                      来源库
                    </button>
                  ) : null}
                  {l.evidence.mediaObjectId ? (
                    <MediaInlineControl
                      familyId={familyId}
                      mediaId={l.evidence.mediaObjectId}
                      evidenceType={l.evidence.evidenceType}
                      title={l.evidence.title}
                      onAuthError={onAuthError}
                      onError={onError}
                    />
                  ) : null}
                </div>
                {evidenceDetailId === l.evidence.id ? (
                  <div className="mt-2 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-2 text-xs text-[color:var(--a-muted)]">
                    {l.evidence.description ? (
                      <p className="whitespace-pre-wrap text-[color:var(--a-ink)]">
                        {l.evidence.description}
                      </p>
                    ) : null}
                    {l.evidence.sourceDateText ? (
                      <p
                        className={
                          l.evidence.description ? "mt-1" : undefined
                        }
                      >
                        年代 / 日期：{l.evidence.sourceDateText}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canEdit ? (
                removingEvidenceId === l.evidence.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[color:var(--a-danger)]">
                      确认取消这条挂接？来源仍留在家族来源库。
                    </span>
                    <button
                      type="button"
                      className="font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)]"
                      disabled={removingBusy}
                      onClick={() => {
                        setRemovingEvidenceId(null);
                        setRemovingEvidenceShared(0);
                      }}
                    >
                      返回
                    </button>
                    <button
                      type="button"
                      className="font-semibold text-[color:var(--a-danger)] hover:underline"
                      disabled={removingBusy}
                      onClick={async () => {
                        setRemovingBusy(true);
                        try {
                          const unlinked = await v1api.unlinkEvidence(
                            familyId,
                            claim.id,
                            l.evidence.id,
                            { idempotencyKey: crypto.randomUUID() }
                          );
                          const label =
                            l.evidence.title?.trim() ||
                            EVIDENCE_TYPE_UI[l.evidence.evidenceType] ||
                            "资料来源";
                          if (onEvidenceUnlinked) {
                            onEvidenceUnlinked({
                              claimId: claim.id,
                              evidenceId: l.evidence.id,
                              relation: unlinked.relation,
                              label,
                            });
                          } else {
                            onFlash(
                              `已取消「${label}」的挂接；来源仍在家族来源库。`
                            );
                          }
                          setRemovingEvidenceId(null);
                          setRemovingEvidenceShared(0);
                          const b = await v1api.getClaim(familyId, claim.id);
                          setBundle(b);
                          await onChanged();
                        } catch (e) {
                          if (onAuthError(e)) return;
                          onError(userMessageForApiError(e));
                          setRemovingEvidenceId(null);
                          setRemovingEvidenceShared(0);
                        } finally {
                          setRemovingBusy(false);
                        }
                      }}
                    >
                      {removingBusy ? "处理中…" : "确认取消挂接"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-danger)]"
                    onClick={() => setRemovingEvidenceId(l.evidence.id)}
                  >
                    取消挂接
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
          linkedEvidenceIds={
            bundle?.evidenceLinks.map((l) => l.evidence.id) ?? []
          }
          defaultEvidenceType={
            forcedEvidenceType ||
            (claim.claimType === "STORY" ? "ORAL_HISTORY" : "GENEALOGY_PAGE")
          }
          onClose={() => {
            setShowEvidence(false);
            setForcedEvidenceType(null);
          }}
          onDone={async () => {
            setShowEvidence(false);
            setForcedEvidenceType(null);
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

function MediaInlineControl({
  familyId,
  mediaId,
  evidenceType,
  title,
  onAuthError,
  onError,
}: {
  familyId: string;
  mediaId: string;
  evidenceType: string;
  title: string | null;
  onAuthError: (e: unknown) => boolean;
  onError: (s: string) => void;
}) {
  const [viewer, setViewer] = useState<{ url: string; label: string } | null>(
    null
  );
  const [playing, setPlaying] = useState<{ url: string; label: string } | null>(
    null
  );

  const preferAudio = evidenceType === "ORAL_HISTORY";
  const label =
    title ||
    EVIDENCE_TYPE_UI[evidenceType] ||
    (preferAudio ? "口述录音" : "原始资料");

  async function open() {
    try {
      const res = await v1api.mediaRead(familyId, mediaId);
      const mime = res.media.mimeType ?? "";
      if (mime.startsWith("image/") || evidenceType === "PHOTO") {
        setPlaying(null);
        setViewer({ url: res.read.url, label });
        return;
      }
      if (mime.startsWith("audio/") || preferAudio) {
        setViewer(null);
        setPlaying({ url: res.read.url, label });
        return;
      }
      window.open(res.read.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (onAuthError(e)) return;
      onError(userMessageForApiError(e));
    }
  }

  return (
    <span className="ml-2 inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
        onClick={() => void open()}
      >
        {preferAudio ? "收听" : "查看"}
      </button>
      {playing ? (
        <div className="mt-1 w-full min-w-[12rem] rounded-xl bg-[color:var(--a-brand-soft)]/50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[color:var(--a-brand)]">
              {playing.label}
            </p>
            <button
              type="button"
              className="text-xs font-semibold text-[color:var(--a-muted)]"
              onClick={() => setPlaying(null)}
            >
              关闭
            </button>
          </div>
          <audio controls autoPlay src={playing.url} className="w-full">
            你的浏览器不支持音频播放。
          </audio>
        </div>
      ) : null}
      {viewer ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={viewer.label}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setViewer(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-[color:var(--a-ink)]"
            onClick={() => setViewer(null)}
          >
            关闭
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.url}
            alt={viewer.label}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </span>
  );
}

function AddEvidenceForm({
  familyId,
  claimId,
  linkedEvidenceIds,
  defaultEvidenceType = "GENEALOGY_PAGE",
  onClose,
  onDone,
  onError,
  onAuthError,
}: {
  familyId: string;
  claimId: string;
  linkedEvidenceIds: string[];
  defaultEvidenceType?: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (s: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [mode, setMode] = useState<"new" | "reuse">("new");
  const [library, setLibrary] = useState<
    Awaited<ReturnType<typeof v1api.listEvidence>>["evidence"]
  >([]);
  const [pickedId, setPickedId] = useState("");
  const [evidenceType, setEvidenceType] = useState(defaultEvidenceType);
  const [title, setTitle] = useState("");
  const [sourceLocator, setSourceLocator] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const leaveWarn = useRef(false);
  const linkedKey = linkedEvidenceIds.slice().sort().join(",");

  useEffect(() => {
    if (mode !== "reuse") return;
    let cancelled = false;
    const linked = new Set(linkedKey.split(",").filter(Boolean));
    v1api
      .listEvidence(familyId)
      .then((r) => {
        if (cancelled) return;
        setLibrary(r.evidence.filter((e) => !linked.has(e.id)));
      })
      .catch((e) => {
        if (cancelled || onAuthError(e)) return;
        setLocalError(userMessageForApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, familyId, linkedKey, onAuthError]);

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

  async function submitReuse(e: FormEvent) {
    e.preventDefault();
    if (!pickedId) {
      setLocalError("请选择一条已有来源");
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      await v1api.linkEvidence(
        familyId,
        claimId,
        { evidenceId: pickedId, relation: "SUPPORTS" },
        { idempotencyKey: crypto.randomUUID() }
      );
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
        const reserved = await v1api.reserveMedia(
          familyId,
          {
            originalFilename: file.name,
            mimeType: mime,
            byteSize: file.size,
          },
          { idempotencyKey: crypto.randomUUID() }
        );
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
      const ev = await v1api.createEvidence(
        familyId,
        {
          evidenceType,
          title: title.trim() || null,
          description: description.trim() || null,
          sourceLocator: sourceLocator.trim() || null,
          mediaObjectId,
        },
        { idempotencyKey: crypto.randomUUID() }
      );
      await v1api.linkEvidence(
        familyId,
        claimId,
        { evidenceId: ev.evidence.id, relation: "SUPPORTS" },
        { idempotencyKey: crypto.randomUUID() }
      );
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

  const reuseOptions = library;

  return (
    <div className="mt-3 rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface-strong)] p-3">
      <div
        className="mb-3 flex flex-wrap gap-2"
        role="group"
        aria-label="添加来源方式"
      >
        <button
          type="button"
          className={`alpha-chip !min-h-[32px] font-semibold ${
            mode === "new" ? "!bg-[color:var(--a-brand-soft)]" : ""
          }`}
          aria-pressed={mode === "new"}
          onClick={() => {
            setMode("new");
            setLocalError("");
          }}
        >
          新建来源
        </button>
        <button
          type="button"
          className={`alpha-chip !min-h-[32px] font-semibold ${
            mode === "reuse" ? "!bg-[color:var(--a-brand-soft)]" : ""
          }`}
          aria-pressed={mode === "reuse"}
          onClick={() => {
            setMode("reuse");
            setLocalError("");
          }}
        >
          使用已有来源
        </button>
      </div>

      {mode === "reuse" ? (
        <form onSubmit={submitReuse} className="space-y-3">
          {localError ? (
            <p className="alpha-alert alpha-alert-error" role="alert">
              {localError}
            </p>
          ) : null}
          {reuseOptions.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-[color:var(--a-muted)]">
                还没有可复用的来源，请先新建一条。
              </p>
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
                onClick={() => {
                  setMode("new");
                  setLocalError("");
                }}
              >
                去新建来源
              </button>
            </div>
          ) : (
            <div>
              <label htmlFor="ev-reuse" className="alpha-label">
                选择已有来源
              </label>
              <select
                id="ev-reuse"
                value={pickedId}
                onChange={(e) => setPickedId(e.target.value)}
                className="alpha-input"
                required
              >
                <option value="">请选择…</option>
                {reuseOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {(EVIDENCE_TYPE_UI[e.evidenceType] ?? "来源") +
                      (e.title ? ` · ${e.title}` : "") +
                      (e.sourceLocator ? ` · ${e.sourceLocator}` : "") +
                      (e.linkCount ? `（已用于 ${e.linkCount} 条资料）` : "")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="alpha-btn alpha-btn-secondary flex-1 !min-h-[44px]"
            >
              取消
            </button>
            {reuseOptions.length > 0 ? (
              <button
                type="submit"
                disabled={busy}
                className="alpha-btn alpha-btn-primary flex-1 !min-h-[44px]"
              >
                {busy ? "保存中…" : "挂到来源"}
              </button>
            ) : null}
          </div>
        </form>
      ) : (
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
      )}
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const dirty =
    name.trim() !== displayName ||
    (sur.trim() || "") !== (surname ?? "");

  const requestClose = useCallback(() => {
    if (busy) return;
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [busy, confirmDiscard, dirty, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || !name.trim()) return;
    setBusy(true);
    setLocalError("");
    setConfirmDiscard(false);
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
    <ModalShell
      title="编辑家族档案"
      onClose={requestClose}
      allowClose={!busy}
    >
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
          可见性仍为「仅家族成员可见」。可在概览页的「邀请家人」里生成链接或发邮件。
        </p>
        {confirmDiscard ? (
          <div className="space-y-3 rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-warn-soft)] p-3">
            <p className="text-sm text-[color:var(--a-ink)]" role="alert">
              有未保存的修改，确定放弃？
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary flex-1"
                onClick={() => setConfirmDiscard(false)}
              >
                继续编辑
              </button>
              <button
                type="button"
                className="alpha-btn alpha-btn-danger flex-1"
                onClick={onClose}
              >
                放弃修改
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              className="alpha-btn alpha-btn-secondary flex-1"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy || !dirty || !name.trim()}
              className="alpha-btn alpha-btn-primary flex-1"
            >
              {busy ? "保存中…" : dirty ? "保存" : "没有需要保存的修改"}
            </button>
          </div>
        )}
      </form>
    </ModalShell>
  );
}

function AddPersonModal({
  familyId,
  existingNames,
  onFinished,
  onAdded,
  onError,
  onAuth,
}: {
  familyId: string;
  existingNames: string[];
  onFinished: (addedCount: number) => void;
  onAdded: () => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const [name, setName] = useState("");
  const [living, setLiving] = useState("UNKNOWN");
  const [gender, setGender] = useState("UNKNOWN");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [addedNames, setAddedNames] = useState<string[]>([]);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const knownNames = [...existingNames, ...addedNames];
  const duplicateName =
    trimmed.length > 0 &&
    knownNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());
  const lastAdded = addedNames[addedNames.length - 1] ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    const preferredName = name.trim();
    try {
      await v1api.createPerson(familyId, {
        preferredName,
        livingStatus: living,
        gender,
      });
      setAddedNames((prev) => [...prev, preferredName]);
      setName("");
      setLiving("UNKNOWN");
      setGender("UNKNOWN");
      await onAdded();
      requestAnimationFrame(() => firstRef.current?.focus());
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
    <ModalShell
      title="添加成员"
      onClose={() => onFinished(addedNames.length)}
      allowClose={!busy}
    >
      <form onSubmit={submit} className="space-y-4">
        {lastAdded ? (
          <p className="alpha-alert alpha-alert-ok" role="status">
            已添加「{lastAdded}」。可继续添加下一位，或点完成。
          </p>
        ) : null}
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
            onClick={() => onFinished(addedNames.length)}
            disabled={busy}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            {addedNames.length > 0 ? "完成" : "取消"}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="alpha-btn alpha-btn-primary flex-1"
          >
            {busy ? "添加中…" : addedNames.length > 0 ? "继续添加" : "添加"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type KinRole = "child" | "parent" | "spouse";

function AddKinModal({
  familyId,
  persons,
  focusPersonId,
  initialRole,
  onClose,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  persons: GraphPerson[];
  focusPersonId: string;
  initialRole: KinRole;
  onClose: () => void;
  onDone: (result: {
    newPersonId?: string;
    createdName?: string;
    seedClaimType: string;
  }) => Promise<void>;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const focus = persons.find((p) => p.id === focusPersonId);
  const focusName = focus?.preferredName ?? "成员";
  const [role, setRole] = useState<KinRole>(initialRole);
  const [source, setSource] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [living, setLiving] = useState("UNKNOWN");
  const [gender, setGender] = useState("UNKNOWN");
  const [otherId, setOtherId] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const others = useMemo(
    () =>
      persons
        .filter((p) => p.id !== focusPersonId)
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons, focusPersonId]
  );

  useEffect(() => {
    setRole(initialRole);
  }, [initialRole]);

  useEffect(() => {
    if (source === "new") nameRef.current?.focus();
  }, [source, role]);

  useEffect(() => {
    if (source === "existing" && !otherId && others[0]) {
      setOtherId(others[0].id);
    }
  }, [source, otherId, others]);

  const roleLabel =
    role === "child" ? "子女" : role === "parent" ? "父母" : "配偶";

  const preview = useMemo(() => {
    if (source === "new") {
      const n = name.trim() || "新成员";
      if (role === "child") return `将记录：${focusName} 是 ${n} 的父母`;
      if (role === "parent") return `将记录：${n} 是 ${focusName} 的父母`;
      return `将记录：${focusName} 与 ${n} 为配偶`;
    }
    const other = persons.find((p) => p.id === otherId);
    if (!other) return "";
    if (role === "child")
      return `将记录：${focusName} 是 ${other.preferredName} 的父母`;
    if (role === "parent")
      return `将记录：${other.preferredName} 是 ${focusName} 的父母`;
    return `将记录：${focusName} 与 ${other.preferredName} 为配偶`;
  }, [source, name, role, focusName, otherId, persons]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      let relatedId = otherId;
      let createdName: string | undefined;
      let newPersonId: string | undefined;
      let livingStatus = living;

      if (source === "new") {
        const trimmed = name.trim();
        if (!trimmed) {
          setLocalError("请填写姓名或常用称呼。");
          return;
        }
        const created = await v1api.createPerson(familyId, {
          preferredName: trimmed,
          gender,
          livingStatus: living,
        });
        relatedId = created.person.id;
        newPersonId = created.person.id;
        createdName = created.person.preferredName;
        livingStatus = created.person.livingStatus;
      } else {
        if (!relatedId || relatedId === focusPersonId) {
          setLocalError("请选择另一位家人。");
          return;
        }
      }

      if (role === "child") {
        await v1api.createRelationship(familyId, {
          fromPersonId: focusPersonId,
          toPersonId: relatedId,
          relationshipType: "BIOLOGICAL_PARENT",
        });
      } else if (role === "parent") {
        await v1api.createRelationship(familyId, {
          fromPersonId: relatedId,
          toPersonId: focusPersonId,
          relationshipType: "BIOLOGICAL_PARENT",
        });
      } else {
        await v1api.createRelationship(familyId, {
          fromPersonId: focusPersonId,
          toPersonId: relatedId,
          relationshipType: "SPOUSE",
        });
      }

      await onDone({
        newPersonId,
        createdName,
        seedClaimType:
          livingStatus === "DECEASED" ? "DEATH_DATE" : "BIRTH_DATE",
      });
    } catch (err) {
      if (onAuth(err)) return;
      const msg = userMessageForApiError(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  const canUseExisting = others.length > 0;

  useEffect(() => {
    if (!canUseExisting && source === "existing") {
      setSource("new");
    }
  }, [canUseExisting, source]);

  return (
    <ModalShell
      title={`为「${focusName}」添加${roleLabel}`}
      onClose={onClose}
      allowClose={!busy}
    >
      <form onSubmit={submit} className="space-y-4">
        {localError ? (
          <p className="alpha-alert alpha-alert-error" role="alert">
            {localError}
          </p>
        ) : null}

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="亲属角色"
        >
          {(
            [
              ["child", "添加子女"],
              ["parent", "添加父母"],
              ["spouse", "添加配偶"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={role === k}
              className={`alpha-chip !min-h-[36px] font-semibold ${
                role === k ? "!bg-[color:var(--a-brand-soft)]" : ""
              }`}
              onClick={() => setRole(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div
            className="flex gap-2"
            role="group"
            aria-label="添加方式"
          >
            <button
              type="button"
              className={`alpha-btn flex-1 !min-h-[40px] !text-sm ${
                source === "new" ? "alpha-btn-primary" : "alpha-btn-secondary"
              }`}
              onClick={() => setSource("new")}
            >
              新建成员
            </button>
            <button
              type="button"
              className={`alpha-btn flex-1 !min-h-[40px] !text-sm ${
                source === "existing"
                  ? "alpha-btn-primary"
                  : "alpha-btn-secondary"
              }`}
              disabled={!canUseExisting}
              title={
                canUseExisting
                  ? undefined
                  : "还没有其他成员可选用，请先新建"
              }
              onClick={() => canUseExisting && setSource("existing")}
            >
              选用已有
            </button>
          </div>
          {!canUseExisting ? (
            <p className="text-sm text-[color:var(--a-muted)]">
              还没有其他成员可选用，请先用「新建成员」添加。
            </p>
          ) : null}
        </div>

        {source === "new" ? (
          <>
            <div>
              <label htmlFor="kin-name" className="alpha-label">
                姓名 / 常用称呼 *
              </label>
              <input
                ref={nameRef}
                id="kin-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="alpha-input"
                placeholder="例如：赵丙"
              />
            </div>
            <div>
              <label htmlFor="kin-living" className="alpha-label">
                是否仍在世
              </label>
              <select
                id="kin-living"
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
              <label htmlFor="kin-gender" className="alpha-label">
                性别（可选）
              </label>
              <select
                id="kin-gender"
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
          </>
        ) : (
          <div>
            <label htmlFor="kin-other" className="alpha-label">
              选择家人
            </label>
            <select
              id="kin-other"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              className="alpha-input"
              required
            >
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.preferredName}
                </option>
              ))}
            </select>
          </div>
        )}

        {preview ? (
          <p className="text-sm text-[color:var(--a-brand)]" role="status">
            {preview}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={
              busy ||
              (source === "new" ? !name.trim() : !otherId) ||
              !preview
            }
            className="alpha-btn alpha-btn-primary flex-1"
          >
            {busy
              ? "保存中…"
              : source === "new"
                ? "添加并建立关系"
                : "建立关系"}
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
  onNeedMorePeople,
  onDone,
  onError,
  onAuth,
}: {
  familyId: string;
  persons: GraphPerson[];
  focusPersonId?: string | null;
  onClose: () => void;
  onNeedMorePeople?: () => void;
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

  const sortedPersons = useMemo(
    () =>
      persons
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons]
  );

  const preview = useMemo(() => {
    const nameOf = (id: string) =>
      persons.find((p) => p.id === id)?.preferredName ?? "成员";
    if (mode === "parent") {
      if (!parentId || !childId || parentId === childId) return "";
      const kind =
        parentType === "ADOPTIVE_PARENT"
          ? "养父母"
          : parentType === "STEP_PARENT"
            ? "继父母"
            : "父母";
      return `将记录：${nameOf(parentId)} 是 ${nameOf(childId)} 的${kind}`;
    }
    if (!aId || !bId || aId === bId) return "";
    return `将记录：${nameOf(aId)} 与 ${nameOf(bId)} 为配偶`;
  }, [mode, parentId, childId, parentType, aId, bId, persons]);

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
          onClick={() => {
            if (onNeedMorePeople) onNeedMorePeople();
            else onClose();
          }}
          className="alpha-btn alpha-btn-primary mt-5 w-full"
        >
          {onNeedMorePeople ? "去添加成员" : "知道了"}
        </button>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="添加家庭关系" onClose={onClose} allowClose={!busy}>
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
                {sortedPersons.map((p) => (
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
                {sortedPersons.map((p) => (
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
                {sortedPersons.map((p) => (
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
                {sortedPersons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {preview ? (
          <p className="text-sm text-[color:var(--a-brand)]" role="status">
            {preview}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="alpha-btn alpha-btn-secondary flex-1"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !preview}
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
  persons,
  generation,
  generationByPerson,
  relationships,
  personMap,
  canEdit,
  canReview,
  externalClaimSeed,
  onExternalClaimSeedConsumed,
  basicsFocus = null,
  onBasicsFocusConsumed,
  onClose,
  onChanged,
  onDeleted,
  onRelationshipRemoved,
  onEvidenceRemoved,
  onEvidenceUnlinked,
  onRequestAddRel,
  onRequestAddKin,
  onShowInLineage,
  onOpenPerson,
  onOpenSourcesLibrary,
  onError,
  onAuth,
}: {
  familyId: string;
  person: GraphPerson;
  persons: GraphPerson[];
  generation?: number;
  generationByPerson: Record<string, number>;
  relationships: GraphRel[];
  personMap: Map<string, GraphPerson>;
  canEdit: boolean;
  canReview: boolean;
  externalClaimSeed?: { claimType: string; nonce: number } | null;
  onExternalClaimSeedConsumed?: () => void;
  basicsFocus?: "living" | "gender" | "name" | null;
  onBasicsFocusConsumed?: () => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: (name: string, personId: string) => Promise<void>;
  onRelationshipRemoved: (
    relationshipId: string,
    label: string
  ) => void | Promise<void>;
  onEvidenceRemoved: (evidenceId: string, label: string) => void;
  onEvidenceUnlinked: (args: {
    claimId: string;
    evidenceId: string;
    relation: string;
    label: string;
  }) => void;
  onRequestAddRel: () => void;
  onRequestAddKin: (role: KinRole) => void;
  onShowInLineage: () => void;
  onOpenPerson: (id: string) => void;
  onOpenSourcesLibrary?: (evidenceId: string) => void;
  onError: (s: string) => void;
  onAuth: (e: unknown) => boolean;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(person.preferredName);
  const [living, setLiving] = useState(person.livingStatus);
  const [gender, setGender] = useState(person.gender);
  /** Last-known server values — dirty uses these so close works before parent reload re-renders. */
  const [savedBasics, setSavedBasics] = useState({
    preferredName: person.preferredName,
    livingStatus: person.livingStatus,
    gender: person.gender,
  });
  const [drawerClaimSeed, setDrawerClaimSeed] = useState<{
    claimType: string;
    nonce: number;
  } | null>(null);
  const [drawerOpenEvidenceClaimId, setDrawerOpenEvidenceClaimId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!externalClaimSeed) return;
    setDrawerClaimSeed(externalClaimSeed);
    onExternalClaimSeedConsumed?.();
  }, [externalClaimSeed, onExternalClaimSeedConsumed]);
  useEffect(() => {
    if (!basicsFocus) return;
    const id =
      basicsFocus === "living"
        ? "edit-living"
        : basicsFocus === "gender"
          ? "edit-gender"
          : "edit-name";
    const t = window.setTimeout(() => {
      const el = document.getElementById(id) as
        | HTMLInputElement
        | HTMLSelectElement
        | null;
      el?.focus();
      if (el && "select" in el) el.select();
      onBasicsFocusConsumed?.();
    }, 0);
    return () => window.clearTimeout(t);
  }, [basicsFocus, person.id, onBasicsFocusConsumed]);
  const [revision, setRevision] = useState(person.revisionNo);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingPersonId, setPendingPersonId] = useState<string | null>(null);
  const [pendingProfile, setPendingProfile] = useState(false);
  const drawerRouter = useRouter();
  const profileHref = `/alpha/families/${familyId}/people/${person.id}`;
  const [deleting, setDeleting] = useState(false);
  const [confirmRelId, setConfirmRelId] = useState<string | null>(null);
  const [removingRel, setRemovingRel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localFlash, setLocalFlash] = useState("");
  const [localUndoClaimId, setLocalUndoClaimId] = useState<string | null>(
    null
  );
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [rejectedOpen, setRejectedOpen] = useState(false);

  useLockBodyScroll();

  const orderedPersons = useMemo(
    () =>
      persons
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons]
  );
  const personIndex = orderedPersons.findIndex((p) => p.id === person.id);
  const prevPerson =
    personIndex > 0 ? orderedPersons[personIndex - 1] : null;
  const nextPerson =
    personIndex >= 0 && personIndex < orderedPersons.length - 1
      ? orderedPersons[personIndex + 1]
      : null;

  useEffect(() => {
    setName(person.preferredName);
    setLiving(person.livingStatus);
    setGender(person.gender);
    setSavedBasics({
      preferredName: person.preferredName,
      livingStatus: person.livingStatus,
      gender: person.gender,
    });
    setRevision(person.revisionNo);
    setConfirmDelete(false);
    setConfirmDiscard(false);
    setPendingPersonId(null);
    setConfirmRelId(null);
    setLocalError("");
  }, [person.id, person.preferredName, person.livingStatus, person.gender, person.revisionNo]);

  useEffect(() => {
    setLocalFlash("");
    setLocalUndoClaimId(null);
  }, [person.id]);

  useEffect(() => {
    if (!localFlash || localUndoClaimId) return;
    const t = window.setTimeout(() => setLocalFlash(""), 4000);
    return () => window.clearTimeout(t);
  }, [localFlash, localUndoClaimId]);

  function flashLocal(msg: string, undoClaimId?: string) {
    setLocalFlash(msg);
    setLocalUndoClaimId(undoClaimId ?? null);
  }

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

  const dirty =
    canEdit &&
    (name.trim() !== savedBasics.preferredName ||
      living !== savedBasics.livingStatus ||
      gender !== savedBasics.gender);

  const discardPending = useCallback(() => {
    const nextId = pendingPersonId;
    const toProfile = pendingProfile;
    setPendingPersonId(null);
    setPendingProfile(false);
    setConfirmDiscard(false);
    if (toProfile) drawerRouter.push(profileHref);
    else if (nextId) onOpenPerson(nextId);
    else onClose();
  }, [pendingPersonId, pendingProfile, drawerRouter, profileHref, onOpenPerson, onClose]);

  const openProfile = useCallback(() => {
    if (dirty) {
      setPendingPersonId(null);
      setPendingProfile(true);
      setConfirmDiscard(true);
      return;
    }
    drawerRouter.push(profileHref);
  }, [dirty, drawerRouter, profileHref]);

  const goToPerson = useCallback(
    (id: string) => {
      if (id === person.id) return;
      if (dirty) {
        setPendingPersonId(id);
        setConfirmDiscard(true);
        return;
      }
      onOpenPerson(id);
    },
    [person.id, dirty, onOpenPerson]
  );

  const requestClose = useCallback(() => {
    if (confirmRelId) {
      setConfirmRelId(null);
      return;
    }
    if (confirmDelete) {
      setConfirmDelete(false);
      return;
    }
    if (confirmDiscard) {
      setConfirmDiscard(false);
      setPendingPersonId(null);
      setPendingProfile(false);
      return;
    }
    if (dirty) {
      setPendingPersonId(null);
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [confirmRelId, confirmDelete, confirmDiscard, dirty, onClose]);

  const drawerRootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRootRef, requestClose, closeBtn);

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
    })
    .sort((a, b) => {
      const order = { 父母: 0, 配偶: 1, 子女: 2 } as Record<string, number>;
      const d = (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
      if (d !== 0) return d;
      return a.otherName.localeCompare(b.otherName, "zh-CN");
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
    if (!canEdit || !dirty) return;
    setBusy(true);
    setLocalError("");
    setConfirmDiscard(false);
    try {
      const res = await v1api.patchPerson(familyId, person.id, {
        expectedRevision: revision,
        preferredName: name.trim(),
        livingStatus: living,
        gender,
      });
      setRevision(res.person.revisionNo);
      setName(res.person.preferredName);
      setLiving(res.person.livingStatus);
      setGender(res.person.gender);
      setSavedBasics({
        preferredName: res.person.preferredName,
        livingStatus: res.person.livingStatus,
        gender: res.person.gender,
      });
      const needsDeath =
        res.person.livingStatus === "DECEASED" &&
        !activeClaims.some((c) => c.claimType === "DEATH_DATE");
      setLocalFlash(
        needsDeath
          ? "已保存基本信息。建议在下方补充去世信息。"
          : "已保存基本信息"
      );
      if (needsDeath) {
        setDrawerClaimSeed({ claimType: "DEATH_DATE", nonce: Date.now() });
      }
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
      ref={drawerRootRef}
      className="fixed inset-0 z-40 flex justify-end bg-[color:var(--a-ink)]/35"
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-drawer-title"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (confirmDelete || confirmRelId) return;
        requestClose();
      }}
    >
      <div className="alpha-drawer-panel flex h-full w-full max-w-md flex-col bg-[color:var(--a-surface-strong)] shadow-[var(--a-shadow)]">
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--a-brand-line)] px-4 py-3">
          <div className="min-w-0 flex-1">
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!prevPerson}
              onClick={() => prevPerson && goToPerson(prevPerson.id)}
              className="min-h-[40px] rounded-lg px-2 text-sm font-semibold text-[color:var(--a-brand)] disabled:opacity-40"
              aria-label={
                prevPerson ? `上一位：${prevPerson.preferredName}` : "没有上一位"
              }
            >
              上一位
            </button>
            <button
              type="button"
              disabled={!nextPerson}
              onClick={() => nextPerson && goToPerson(nextPerson.id)}
              className="min-h-[40px] rounded-lg px-2 text-sm font-semibold text-[color:var(--a-brand)] disabled:opacity-40"
              aria-label={
                nextPerson ? `下一位：${nextPerson.preferredName}` : "没有下一位"
              }
            >
              下一位
            </button>
            <button
              ref={closeBtn}
              type="button"
              onClick={requestClose}
              className="min-h-[44px] min-w-[44px] rounded-lg text-sm font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)]"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {confirmDiscard ? (
            <div className="mb-3 space-y-3 rounded-xl bg-[color:var(--a-warn-soft)] px-3 py-3 ring-1 ring-[color:var(--a-brand-line)]">
              <p className="text-sm font-semibold text-[color:var(--a-ink)]" role="alert">
                {pendingPersonId
                  ? "有未保存的修改，切换成员前要放弃吗？"
                  : pendingProfile
                    ? "有未保存的修改，打开人物页前要放弃吗？"
                    : "有未保存的修改，确定放弃？"}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="alpha-btn alpha-btn-secondary flex-1 !min-h-[40px] !text-sm"
                  onClick={() => {
                    setConfirmDiscard(false);
                    setPendingPersonId(null);
                    setPendingProfile(false);
                  }}
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  className="alpha-btn alpha-btn-danger flex-1 !min-h-[40px] !text-sm"
                  onClick={discardPending}
                >
                  放弃修改
                </button>
              </div>
            </div>
          ) : null}
          {localError ? (
            <p className="mb-3 alpha-alert alpha-alert-error" role="alert">
              {localError}
            </p>
          ) : null}
          {localFlash ? (
            <div
              className="mb-3 flex flex-wrap items-start justify-between gap-3 alpha-alert alpha-alert-ok"
              role="status"
            >
              <p className="min-w-0 flex-1">{localFlash}</p>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {localUndoClaimId ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => {
                      const id = localUndoClaimId;
                      setLocalUndoClaimId(null);
                      setLocalFlash("");
                      void (async () => {
                        try {
                          await v1api.reopenClaim(familyId, id, {
                            idempotencyKey: crypto.randomUUID(),
                          });
                          setLocalFlash(
                            "已重新打开这条资料，可再次确认或不采用"
                          );
                          await loadClaims();
                          onChanged();
                        } catch (e) {
                          if (onAuth(e)) return;
                          setLocalError(userMessageForApiError(e));
                        }
                      })();
                    }}
                  >
                    恢复
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-sm text-[color:var(--a-muted)] underline-offset-2 hover:underline"
                  onClick={() => {
                    setLocalFlash("");
                    setLocalUndoClaimId(null);
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
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
                disabled={busy || !dirty}
                className="alpha-btn alpha-btn-primary w-full !min-h-[44px] !text-sm"
              >
                {busy ? "保存中…" : dirty ? "保存基本信息" : "没有需要保存的修改"}
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
                              await v1api.deleteRelationship(
                                familyId,
                                row.id,
                                { idempotencyKey: crypto.randomUUID() }
                              );
                              setConfirmRelId(null);
                              const otherName =
                                personMap.get(row.otherId)?.preferredName ??
                                "成员";
                              await onRelationshipRemoved(
                                row.id,
                                `「${person.preferredName}」与「${otherName}」的${row.kind}关系`
                              );
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
              {canEdit
                ? "暂无关系。建立父母/配偶关系后，世系页会按代展示。"
                : "暂无关系。有编辑权限的家人补充后，会显示在这里。"}
            </p>
          )}
          {canEdit ? (
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label="为这位家人添加亲人"
            >
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                onClick={() => onRequestAddKin("child")}
              >
                添加子女
              </button>
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                onClick={() => onRequestAddKin("parent")}
              >
                添加父母
              </button>
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                onClick={() => onRequestAddKin("spouse")}
              >
                添加配偶
              </button>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3">
            {canEdit ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)]"
                onClick={onRequestAddRel}
              >
                {persons.length < 2
                  ? "去添加成员"
                  : relRows.length
                    ? "再添加一条关系"
                    : "选用已有成员建立关系"}
              </button>
            ) : null}
            {relRows.length > 0 ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)]"
                onClick={onShowInLineage}
              >
                在世系中查看
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-brand)]"
              onClick={openProfile}
            >
              查看人物页
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
              generationByPerson={generationByPerson}
              relationships={relationships}
              persons={persons}
              seedClaimType={drawerClaimSeed?.claimType ?? null}
              seedNonce={drawerClaimSeed?.nonce ?? null}
              onSeedConsumed={() => setDrawerClaimSeed(null)}
              onAuthError={onAuth}
              onDone={async ({ claimType: savedType, claimId }) => {
                const followUp = nextClaimAfterSave(
                  savedType,
                  activeClaims.map((c) => c.claimType),
                  living
                );
                setLocalFlash(flashAfterClaimSave(followUp, savedType));
                await loadClaims();
                if (followUp) {
                  setDrawerClaimSeed({ claimType: followUp, nonce: Date.now() });
                } else {
                  setDrawerOpenEvidenceClaimId(claimId);
                }
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
            const others = rows.filter((r) => r.status !== "CONFLICTED");
            const label = CLAIM_TYPE_UI[type]?.label ?? type;
            const showChooser = conflicted.length >= 2;
            const listRows = showChooser ? others : rows;
            return (
              <section
                key={type}
                className="mb-4 rounded-2xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] p-3"
              >
                <h4 className="font-bold text-[color:var(--a-ink)]">{label}</h4>
                {showChooser ? (
                  <ConflictChooser
                    familyId={familyId}
                    claims={conflicted}
                    canReview={canReview}
                    canEdit={canEdit}
                    onChanged={loadClaims}
                    onError={(msg) => {
                      setLocalError(msg);
                      onError(msg);
                    }}
                    onFlash={flashLocal}
                    onAuthError={onAuth}
                    onOpenEvidenceAfterAccept={(id) =>
                      setDrawerOpenEvidenceClaimId(id)
                    }
                  />
                ) : null}
                {listRows.length > 0 ? (
                  <ul className="mt-3 space-y-3">
                    {listRows.map((c) => (
                      <ClaimCard
                        key={c.id}
                        familyId={familyId}
                        claim={c}
                        canEdit={canEdit}
                        canReview={canReview}
                        autoOpenEvidence={drawerOpenEvidenceClaimId === c.id}
                        onAutoOpenEvidenceConsumed={() =>
                          setDrawerOpenEvidenceClaimId(null)
                        }
                        onOpenEvidenceAfterAccept={(id) =>
                          setDrawerOpenEvidenceClaimId(id)
                        }
                        onProposeAlternate={(claimType) => {
                          setDrawerClaimSeed({
                            claimType,
                            nonce: Date.now(),
                          });
                        }}
                        onOpenSourcesLibrary={onOpenSourcesLibrary}
                        onAuthError={onAuth}
                        onChanged={loadClaims}
                        onError={(msg) => {
                          setLocalError(msg);
                          onError(msg);
                        }}
                        onFlash={flashLocal}
                        onEvidenceRemoved={onEvidenceRemoved}
                        onEvidenceUnlinked={onEvidenceUnlinked}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {rejectedClaims.length > 0 ? (
            <details
              data-rejected-claims
              open={rejectedOpen}
              onToggle={(e) => setRejectedOpen(e.currentTarget.open)}
              className="mt-2 rounded-xl border border-[color:var(--a-brand-line)]/25 bg-[color:var(--a-surface)] p-3"
            >
              <summary className="cursor-pointer font-semibold text-[color:var(--a-muted)]">
                查看不采用的记录（{rejectedClaims.length}）
              </summary>
              <ul className="mt-2 space-y-2 text-sm text-[color:var(--a-muted)]">
                {rejectedClaims.map((c) => (
                  <li
                    key={c.id}
                    data-claim-id={c.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-1 py-0.5"
                  >
                    <span>
                      {CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType}：
                      {c.value?.text ?? "—"}（不采用）
                    </span>
                    {canReview ? (
                      <button
                        type="button"
                        className="shrink-0 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        onClick={async () => {
                          try {
                            await v1api.reopenClaim(familyId, c.id, {
                              idempotencyKey: crypto.randomUUID(),
                            });
                            setLocalFlash(
                              "已重新打开这条资料，可再次确认或不采用"
                            );
                            setRejectedOpen(false);
                            await loadClaims();
                            requestAnimationFrame(() => {
                              document
                                .querySelector(
                                  `[data-claim-id="${c.id}"]`
                                )
                                ?.scrollIntoView({
                                  block: "nearest",
                                  behavior: "smooth",
                                });
                            });
                          } catch (e) {
                            if (onAuth(e)) return;
                            const msg = userMessageForApiError(e);
                            setLocalError(msg);
                            onError(msg);
                          }
                        }}
                      >
                        恢复待确认
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {!claimsLoading && activeClaims.length === 0 ? (
            <div>
              <p className="text-sm text-[color:var(--a-muted)]">
                {canEdit
                  ? "还没有人物资料，可以从出生信息等开始记录。"
                  : "暂无人物资料。"}
              </p>
              {canEdit ? (
                <ClaimStartCtas
                  livingStatus={living}
                  onPick={(claimType) =>
                    setDrawerClaimSeed({ claimType, nonce: Date.now() })
                  }
                />
              ) : null}
            </div>
          ) : null}
          {!claimsLoading && activeClaims.length > 0 && canEdit ? (
            <ClaimStartCtas
              variant="more"
              livingStatus={living}
              presentTypes={[...new Set(activeClaims.map((c) => c.claimType))]}
              onPick={(claimType) =>
                setDrawerClaimSeed({ claimType, nonce: Date.now() })
              }
            />
          ) : null}

          {canReview ? (
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
                    确认移除「{person.preferredName}」？相关家庭关系也会一并取消。移除后不会出现在成员与世系中；若误删，可在概览「最近动态」里恢复。
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
                        const removedName = person.preferredName;
                        try {
                          await v1api.deletePerson(familyId, person.id, {
                            idempotencyKey: crypto.randomUUID(),
                          });
                          await onDeleted(removedName, person.id);
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
  allowClose = true,
  children,
}: {
  title: string;
  onClose: () => void;
  allowClose?: boolean;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const requestClose = useCallback(() => {
    if (!allowClose) return;
    onClose();
  }, [allowClose, onClose]);
  useLockBodyScroll();
  useFocusTrap(rootRef, requestClose);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-40 overflow-y-auto bg-[color:var(--a-ink)]/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
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
              onClick={requestClose}
              disabled={!allowClose}
              className="min-h-[40px] px-2 text-sm font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-ink)] disabled:opacity-40"
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
