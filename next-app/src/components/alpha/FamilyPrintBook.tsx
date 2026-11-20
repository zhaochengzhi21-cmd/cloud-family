"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CLAIM_TYPE_UI,
  ERROR_COPY,
  EVIDENCE_TYPE_UI,
  GENDER_LABEL,
  LIVING_STATUS_LABEL,
  PRODUCT,
  birthOrderRank,
  generationLabel,
  generationWordsByGeneration,
} from "@/v1/ui/copy";
import {
  userMessageForApiError,
  v1api,
  V1ApiError,
  type FamilyExportJson,
} from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";

type Book = FamilyExportJson;
type BookPerson = Book["persons"][number];
type BookFact = BookPerson["facts"][number];

const FACT_ORDER = [
  "BIRTH_DATE",
  "BIRTH_PLACE",
  "DEATH_DATE",
  "BURIAL_PLACE",
  "ANCESTRAL_PLACE",
  "GENERATION_WORD",
  "BIRTH_ORDER",
  "ALIAS",
  "OCCUPATION",
] as const;

const PARENT_TYPES = new Set([
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
]);

function factText(f: BookFact): string {
  const v = f.value as { text?: unknown } | null;
  return typeof v?.text === "string" ? v.text : "—";
}

/** Same rule as the person page: accepted wins, otherwise keep every open version. */
function shownFacts(facts: BookFact[], type: string): BookFact[] {
  const rows = facts.filter(
    (f) => f.claimType === type && f.status !== "REJECTED"
  );
  const accepted = rows.filter((f) => f.status === "ACCEPTED");
  return accepted.length ? accepted : rows;
}

function firstFactText(facts: BookFact[], type: string): string | null {
  const rows = shownFacts(facts, type);
  if (!rows.length) return null;
  const t = factText(rows[0]);
  return t === "—" ? null : t;
}

function byName(a: BookPerson, b: BookPerson) {
  return a.preferredName.localeCompare(b.preferredName, "zh-CN");
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function FamilyPrintBook({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const fetchOnce = () => v1api.exportFamily(familyId);
    const transient = (e: unknown) =>
      e instanceof V1ApiError && (e.status === 0 || e.status >= 500);
    fetchOnce()
      .catch((e) => (transient(e) && !cancelled ? fetchOnce() : Promise.reject(e)))
      .then((r) => {
        if (!cancelled) setBook(r.export);
      })
      .catch((e) => {
        if (cancelled || handleAuthRedirect(e, router)) return;
        setError(
          e instanceof V1ApiError && e.status === 404
            ? ERROR_COPY.notFound
            : userMessageForApiError(e)
        );
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, router, attempt]);

  useEffect(() => {
    if (!book) return;
    const prev = document.title;
    document.title = `${book.family.displayName} · 家谱`;
    return () => {
      document.title = prev;
    };
  }, [book]);

  const layout = useMemo(() => {
    if (!book) return null;
    const byId = new Map(book.persons.map((p) => [p.id, p]));
    const orderOf = (p: BookPerson) => {
      const raw = firstFactText(p.facts, "BIRTH_ORDER");
      return raw ? birthOrderRank(raw) : null;
    };
    type KinRef = { id: string; name: string };
    const kin = new Map<
      string,
      { parents: KinRef[]; spouses: KinRef[]; children: BookPerson[] }
    >();
    const entry = (id: string) => {
      let k = kin.get(id);
      if (!k) {
        k = { parents: [], spouses: [], children: [] };
        kin.set(id, k);
      }
      return k;
    };
    const pushUnique = (list: KinRef[], person: BookPerson) => {
      if (list.some((x) => x.id === person.id)) return;
      list.push({ id: person.id, name: person.preferredName });
    };
    for (const r of book.relationships) {
      const from = byId.get(r.fromPersonId);
      const to = byId.get(r.toPersonId);
      if (!from || !to) continue;
      if (PARENT_TYPES.has(r.type)) {
        pushUnique(entry(to.id).parents, from);
        entry(from.id).children.push(to);
      } else if (r.type === "SPOUSE") {
        pushUnique(entry(from.id).spouses, to);
        pushUnique(entry(to.id).spouses, from);
      }
    }
    for (const k of kin.values()) {
      k.children.sort((a, b) => {
        const ra = orderOf(a);
        const rb = orderOf(b);
        if (ra != null && rb != null && ra !== rb) return ra - rb;
        if (ra != null && rb == null) return -1;
        if (ra == null && rb != null) return 1;
        return a.preferredName.localeCompare(b.preferredName, "zh-CN");
      });
    }

    // No edges → engine still assigns every person gen 1; don't print that as「第一代」.
    const unlinked = book.relationships.length === 0;
    const groups = new Map<number | null, BookPerson[]>();
    for (const p of book.persons) {
      const gen = unlinked ? null : p.generation;
      const list = groups.get(gen) ?? [];
      list.push(p);
      groups.set(gen, list);
    }
    const order = [...groups.keys()].sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a - b
    );

    // Footnote numbers follow reading order so the list at the end reads naturally.
    const sourceNo = new Map<string, number>();
    const generations = order.map((g) => {
      const people = (groups.get(g) ?? []).slice().sort((a, b) => {
        const ra = orderOf(a);
        const rb = orderOf(b);
        if (ra != null && rb != null && ra !== rb) return ra - rb;
        if (ra != null && rb == null) return -1;
        if (ra == null && rb != null) return 1;
        return byName(a, b);
      });
      for (const p of people) {
        for (const t of [...FACT_ORDER, "STORY"] as const) {
          for (const f of shownFacts(p.facts, t)) {
            for (const s of f.sources) {
              if (!sourceNo.has(s.sourceId)) {
                sourceNo.set(s.sourceId, sourceNo.size + 1);
              }
            }
          }
        }
      }
      return { generation: g, people };
    });
    const wordsByPerson: Record<string, string> = {};
    const generationByPerson: Record<string, number> = {};
    for (const p of book.persons) {
      if (p.generation) generationByPerson[p.id] = p.generation;
      const accepted = p.facts.find(
        (f) => f.claimType === "GENERATION_WORD" && f.status === "ACCEPTED"
      );
      if (accepted && factText(accepted) !== "—") {
        wordsByPerson[p.id] = factText(accepted);
      }
    }
    const wordsByGen = generationWordsByGeneration(
      wordsByPerson,
      generationByPerson
    );
    const sourceById = new Map(book.sources.map((s) => [s.id, s]));
    const notes = [...sourceNo.entries()]
      .map(([id, n]) => ({ n, source: sourceById.get(id) }))
      .filter((x) => x.source);

    return {
      kin,
      generations,
      sourceNo,
      notes,
      wordsByGen,
      generationCount: order.filter((g) => g !== null).length,
    };
  }, [book]);

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-[color:var(--a-danger)]" role="alert">
          {error}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="alpha-btn alpha-btn-primary !min-h-[40px] !text-sm"
          >
            重试
          </button>
          <Link
            href={`/alpha/families/${familyId}`}
            className="alpha-btn alpha-btn-secondary inline-flex !min-h-[40px] !text-sm"
          >
            返回家族档案
          </Link>
        </div>
      </div>
    );
  }

  if (!book || !layout) {
    return (
      <p className="py-16 text-center text-[color:var(--a-muted)]" role="status">
        正在整理家谱…
      </p>
    );
  }

  if (book.persons.length === 0) {
    return (
      <div className="alpha-fade-in py-2">
        <Link
          href={`/alpha/families/${familyId}`}
          className="alpha-print-hide text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
        >
          ← {book.family.displayName || PRODUCT.family}
        </Link>
        <div className="alpha-panel mt-8 border-dashed px-4 py-12 text-center">
          <h1 className="alpha-font-display text-2xl font-bold text-[color:var(--a-ink)]">
            {book.family.displayName}
          </h1>
          <p className="mt-3 text-[color:var(--a-muted)]">
            还没有成员可排进家谱。先回到家族档案添加家人。
          </p>
          <Link
            href={`/alpha/families/${familyId}`}
            className="alpha-btn alpha-btn-primary mt-6 inline-flex !min-h-[40px] !text-sm"
          >
            返回家族档案
          </Link>
        </div>
      </div>
    );
  }

  return (
    <article className="alpha-fade-in py-2">
      <div className="alpha-print-hide mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/alpha/families/${familyId}`}
          className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
        >
          ← {book.family.displayName || PRODUCT.family}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="alpha-btn alpha-btn-primary !min-h-[40px] !text-sm"
        >
          打印或保存为 PDF
        </button>
      </div>

      <header className="mb-10 border-b border-[color:var(--a-brand-line)] pb-6 text-center">
        <h1 className="alpha-font-display text-4xl font-bold tracking-widest text-[color:var(--a-ink)]">
          {book.family.displayName}
        </h1>
        <p className="mt-3 text-sm text-[color:var(--a-muted)]">
          共 {book.persons.length} 位成员
          {layout.generationCount > 0 ? ` · ${layout.generationCount} 代` : ""}
          {" · "}整理于 {dateLabel(book.exportedAt)}
        </p>
      </header>

      {book.relationships.length === 0 ? (
        <div className="alpha-print-hide mb-8 text-center">
          <p className="text-sm text-[color:var(--a-muted)]">
            尚未建立家庭关系。在世系里添加父母或配偶后，这里会按世代排版。
          </p>
          <Link
            href={`/alpha/families/${familyId}`}
            onClick={() => {
              try {
                sessionStorage.setItem(`alpha-tab:${familyId}`, "lineage");
              } catch {
                /* private mode */
              }
            }}
            className="alpha-btn alpha-btn-secondary mt-4 inline-flex !min-h-[40px] !text-sm"
          >
            去建立关系
          </Link>
        </div>
      ) : null}

      {layout.generations.map(({ generation, people }) => (
        <section
          key={generation ?? "unknown"}
          aria-labelledby={`book-gen-${generation ?? "unknown"}`}
          className="mb-10"
        >
          <h2
            id={`book-gen-${generation ?? "unknown"}`}
            className="alpha-font-display mb-4 text-xl font-bold text-[color:var(--a-brand)]"
          >
            {generation
              ? generationLabel(generation)
              : book.relationships.length === 0
                ? "成员"
                : "代数未定"}
            {generation && layout.wordsByGen.get(generation)?.length ? (
              <span className="ml-3 text-base font-normal text-[color:var(--a-ink)]">
                字辈
                {layout.wordsByGen
                  .get(generation)!
                  .slice(0, 3)
                  .map((w) => `「${w.word}」`)
                  .join("")}
              </span>
            ) : null}
          </h2>
          <div className="space-y-4">
            {people.map((p) => (
              <BookEntry
                key={p.id}
                familyId={familyId}
                person={p}
                kin={layout.kin.get(p.id)}
                sourceNo={layout.sourceNo}
              />
            ))}
          </div>
        </section>
      ))}

      {layout.notes.length > 0 ? (
        <section aria-labelledby="book-sources" className="alpha-print-avoid-break">
          <h2
            id="book-sources"
            className="mb-3 border-t border-[color:var(--a-brand-line)] pt-6 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
          >
            资料来源
          </h2>
          <ol className="space-y-1 text-sm text-[color:var(--a-ink)]">
            {layout.notes.map(({ n, source }) => {
              const label = [
                EVIDENCE_TYPE_UI[source!.evidenceType] ?? "来源",
                source!.title,
                source!.sourceLocator,
                source!.sourceDateText,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={n}>
                  <span className="alpha-print-only">
                    [{n}] {label}
                  </span>
                  <Link
                    href={`/alpha/families/${familyId}`}
                    className="alpha-print-hide font-semibold text-[color:var(--a-ink)] underline-offset-2 hover:underline"
                    onClick={() => focusEvidenceInWorkspace(familyId, source!.id)}
                  >
                    [{n}] {label}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function focusEvidenceInWorkspace(familyId: string, evidenceId: string) {
  try {
    sessionStorage.setItem(`alpha-evidence-focus:${familyId}`, evidenceId);
    sessionStorage.setItem(`alpha-tab:${familyId}`, "overview");
  } catch {
    /* private mode */
  }
}

function PrintPersonLink({
  familyId,
  id,
  name,
}: {
  familyId: string;
  id: string;
  name: string;
}) {
  return (
    <>
      <Link
        href={`/alpha/families/${familyId}/people/${id}`}
        className="alpha-print-hide text-[color:var(--a-ink)] underline-offset-2 hover:underline"
      >
        {name}
      </Link>
      <span className="alpha-print-only">{name}</span>
    </>
  );
}

function PrintCiteMark({
  familyId,
  evidenceId,
  n,
}: {
  familyId: string;
  evidenceId: string;
  n: number | undefined;
}) {
  if (n == null) return null;
  return (
    <>
      <sup className="alpha-print-only ml-0.5 text-[color:var(--a-muted)]">
        [{n}]
      </sup>
      <Link
        href={`/alpha/families/${familyId}`}
        aria-label={`查看来源 ${n}`}
        className="alpha-print-hide ml-0.5 align-super text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
        onClick={() => focusEvidenceInWorkspace(familyId, evidenceId)}
      >
        [{n}]
      </Link>
    </>
  );
}

function BookEntry({
  familyId,
  person,
  kin,
  sourceNo,
}: {
  familyId: string;
  person: BookPerson;
  kin?: {
    parents: { id: string; name: string }[];
    spouses: { id: string; name: string }[];
    children: BookPerson[];
  };
  sourceNo: Map<string, number>;
}) {
  const meta = [
    person.gender !== "UNKNOWN"
      ? GENDER_LABEL[person.gender as keyof typeof GENDER_LABEL]
      : null,
    LIVING_STATUS_LABEL[person.livingStatus as keyof typeof LIVING_STATUS_LABEL],
  ].filter(Boolean);
  const facts = FACT_ORDER.map((t) => ({
    type: t,
    rows: shownFacts(person.facts, t),
  })).filter((x) => x.rows.length > 0);
  const stories = shownFacts(person.facts, "STORY");
  const childRefs = (kin?.children ?? []).map((c) => {
    const raw = firstFactText(c.facts, "BIRTH_ORDER");
    return {
      id: c.id,
      name: raw ? `${raw}${c.preferredName}` : c.preferredName,
    };
  });
  const kinRows = kin
    ? ([
        ["父母", kin.parents],
        ["配偶", kin.spouses],
        ["子女", childRefs],
      ] as const).filter(([, refs]) => refs.length > 0)
    : [];

  return (
    <div className="alpha-panel alpha-print-avoid-break px-5 py-4">
      <h3 className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]">
        <PrintPersonLink
          familyId={familyId}
          id={person.id}
          name={person.preferredName}
        />
        {meta.length ? (
          <span className="ml-3 text-sm font-normal text-[color:var(--a-muted)]">
            {meta.join(" · ")}
          </span>
        ) : null}
      </h3>
      {facts.length + kinRows.length + stories.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          {facts.map(({ type, rows }) => (
            <div key={type} className="contents">
              <dt className="text-[color:var(--a-muted)]">
                {CLAIM_TYPE_UI[type]?.label ?? type}
              </dt>
              <dd className="text-[color:var(--a-ink)]">
                {rows.map((f, i) => (
                  <span key={f.id}>
                    {i > 0 ? "；" : ""}
                    {factText(f)}
                    {f.sources.map((s) => (
                      <PrintCiteMark
                        key={s.sourceId}
                        familyId={familyId}
                        evidenceId={s.sourceId}
                        n={sourceNo.get(s.sourceId)}
                      />
                    ))}
                    {f.status !== "ACCEPTED" ? (
                      <span className="ml-1 text-xs text-[color:var(--a-muted)]">
                        （待确认）
                      </span>
                    ) : null}
                  </span>
                ))}
                {rows.length > 1 ? (
                  <span className="ml-1 text-xs text-[color:var(--a-brand)]">
                    存在不同说法
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
          {kinRows.map(([label, refs]) => (
            <div key={label} className="contents">
              <dt className="text-[color:var(--a-muted)]">{label}</dt>
              <dd className="text-[color:var(--a-ink)]">
                {refs.map((ref, i) => (
                  <span key={ref.id}>
                    {i > 0 ? "、" : ""}
                    <PrintPersonLink
                      familyId={familyId}
                      id={ref.id}
                      name={ref.name}
                    />
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-sm text-[color:var(--a-muted)]">暂无更多记录</p>
      )}
      {stories.length > 0 ? (
        <div className="mt-3 space-y-3 border-t border-[color:var(--a-brand-line)] pt-3">
          <p className="text-sm font-semibold text-[color:var(--a-brand)]">
            故事与口述
          </p>
          {stories.map((f) => {
            const v = f.value as { text?: string; narrator?: string | null };
            return (
              <div key={f.id}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--a-ink)]">
                  {typeof v?.text === "string" ? v.text : "—"}
                </p>
                {v?.narrator ? (
                  <p className="mt-1 text-xs text-[color:var(--a-muted)]">
                    讲述：{v.narrator}
                  </p>
                ) : null}
                {f.sources.map((s) => (
                  <PrintCiteMark
                    key={s.sourceId}
                    familyId={familyId}
                    evidenceId={s.sourceId}
                    n={sourceNo.get(s.sourceId)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
