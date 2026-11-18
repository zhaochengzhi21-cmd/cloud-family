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
    const kin = new Map<
      string,
      { parents: string[]; spouses: string[]; children: string[] }
    >();
    const entry = (id: string) => {
      let k = kin.get(id);
      if (!k) {
        k = { parents: [], spouses: [], children: [] };
        kin.set(id, k);
      }
      return k;
    };
    for (const r of book.relationships) {
      const from = byId.get(r.fromPersonId);
      const to = byId.get(r.toPersonId);
      if (!from || !to) continue;
      if (PARENT_TYPES.has(r.type)) {
        entry(to.id).parents.push(from.preferredName);
        entry(from.id).children.push(to.preferredName);
      } else if (r.type === "SPOUSE") {
        entry(from.id).spouses.push(to.preferredName);
        entry(to.id).spouses.push(from.preferredName);
      }
    }

    const groups = new Map<number | null, BookPerson[]>();
    for (const p of book.persons) {
      const list = groups.get(p.generation) ?? [];
      list.push(p);
      groups.set(p.generation, list);
    }
    const order = [...groups.keys()].sort((a, b) =>
      a === null ? 1 : b === null ? -1 : a - b
    );

    // Footnote numbers follow reading order so the list at the end reads naturally.
    const sourceNo = new Map<string, number>();
    const generations = order.map((g) => {
      const people = (groups.get(g) ?? []).slice().sort(byName);
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
            {generation ? generationLabel(generation) : "代数未定"}
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
            {layout.notes.map(({ n, source }) => (
              <li key={n}>
                [{n}]{" "}
                {[
                  EVIDENCE_TYPE_UI[source!.evidenceType] ?? "来源",
                  source!.title,
                  source!.sourceLocator,
                  source!.sourceDateText,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function BookEntry({
  person,
  kin,
  sourceNo,
}: {
  person: BookPerson;
  kin?: { parents: string[]; spouses: string[]; children: string[] };
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
  const kinRows = kin
    ? ([
        ["父母", kin.parents],
        ["配偶", kin.spouses],
        ["子女", kin.children],
      ] as const).filter(([, names]) => names.length > 0)
    : [];

  return (
    <div className="alpha-panel alpha-print-avoid-break px-5 py-4">
      <h3 className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]">
        {person.preferredName}
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
                      <sup key={s.sourceId} className="ml-0.5 text-[color:var(--a-muted)]">
                        [{sourceNo.get(s.sourceId)}]
                      </sup>
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
          {kinRows.map(([label, names]) => (
            <div key={label} className="contents">
              <dt className="text-[color:var(--a-muted)]">{label}</dt>
              <dd className="text-[color:var(--a-ink)]">{names.join("、")}</dd>
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
                  <sup key={s.sourceId} className="ml-0.5 text-[color:var(--a-muted)]">
                    [{sourceNo.get(s.sourceId)}]
                  </sup>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
