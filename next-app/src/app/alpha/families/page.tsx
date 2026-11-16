"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMPTY_FAMILIES, PRODUCT, ROLE_LABEL } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";

function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

type FamilyItem = {
  id: string;
  displayName: string;
  surname: string | null;
  role: string;
  currentVersionNo: number;
};

export default function AlphaFamiliesPage() {
  const router = useRouter();
  const [families, setFamilies] = useState<FamilyItem[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [surname, setSurname] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEscapeClose(creating, () => {
    if (!busy) setCreating(false);
  });

  useEffect(() => {
    if (creating) nameInputRef.current?.focus();
  }, [creating]);

  const filtered = useMemo(() => {
    if (!families) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? families.filter(
          (f) =>
            f.displayName.toLowerCase().includes(q) ||
            (f.surname ?? "").toLowerCase().includes(q)
        )
      : families;
    return list
      .slice()
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, "zh-CN")
      );
  }, [families, query]);

  async function load() {
    setError("");
    try {
      const res = await v1api.listFamilies();
      setFamilies(res.families);
    } catch (e) {
      if (handleAuthRedirect(e, router)) return;
      setError(userMessageForApiError(e));
      setFamilies([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = `我的家族 · ${PRODUCT.brand}`;
    return () => {
      document.title = prev;
    };
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await v1api.createFamily({
        displayName: displayName.trim(),
        surname: surname.trim() || null,
      });
      router.push(`/alpha/families/${res.family.id}`);
    } catch (err) {
      if (handleAuthRedirect(err, router)) return;
      setError(userMessageForApiError(err));
    } finally {
      setBusy(false);
    }
  }

  if (families === null && !error) {
    return (
      <p
        className="py-16 text-center text-[color:var(--a-muted)]"
        role="status"
      >
        正在读取你的家族档案…
      </p>
    );
  }

  return (
    <div className="alpha-fade-in py-2">
      <header className="mb-8">
        <h1 className="alpha-font-display text-3xl font-bold text-[color:var(--a-ink)]">
          我的家族
        </h1>
        <p className="mt-2 text-base text-[color:var(--a-muted)]">
          管理你参与的{PRODUCT.family}
        </p>
      </header>

      {error ? (
        <div className="mb-4 space-y-3">
          <p className="alpha-alert alpha-alert-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            onClick={() => void load()}
          >
            重新加载
          </button>
        </div>
      ) : null}

      {families && families.length === 0 && !creating ? (
        <div className="alpha-panel px-6 py-12 text-center">
          <p className="text-sm font-semibold tracking-wide text-[color:var(--a-brand)]">
            从这里开始
          </p>
          <h2 className="alpha-font-display mt-2 text-2xl font-bold text-[color:var(--a-ink)]">
            {EMPTY_FAMILIES.title}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-[color:var(--a-muted)]">
            {EMPTY_FAMILIES.body}
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="alpha-btn alpha-btn-primary mt-8"
          >
            {EMPTY_FAMILIES.cta}
          </button>
        </div>
      ) : null}

      {families && families.length > 0 ? (
        <div>
          {families.length >= 2 ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按名称或姓氏筛选"
              aria-label="筛选家族档案"
              className="alpha-input mb-4"
            />
          ) : null}
          {filtered.length === 0 ? (
            <div className="mb-4 py-6 text-center">
              <p className="text-sm text-[color:var(--a-muted)]">
                没有匹配「{query.trim()}」的家族
              </p>
              {query.trim() ? (
                <button
                  type="button"
                  className="alpha-btn alpha-btn-secondary mt-4 !min-h-[40px] !text-sm"
                  onClick={() => setQuery("")}
                >
                  清除筛选
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/alpha/families/${f.id}`}
                    className="alpha-panel alpha-panel-interactive flex min-h-[64px] items-center justify-between px-4 py-3"
                  >
                    <div>
                      <p className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]">
                        {f.displayName}
                      </p>
                      <p className="mt-0.5 text-sm text-[color:var(--a-muted)]">
                        {[
                          f.surname,
                          ROLE_LABEL[f.role as keyof typeof ROLE_LABEL] ||
                            f.role,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[color:var(--a-brand)]">
                      打开
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="alpha-btn alpha-btn-ghost mt-3 !justify-start !px-0"
          >
            + 创建家族档案
          </button>
        </div>
      ) : null}

      {creating ? (
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-[color:var(--a-ink)]/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-family-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setCreating(false);
          }}
        >
          <div className="flex min-h-full items-center justify-center py-6">
            <form
              onSubmit={onCreate}
              className="alpha-fade-in w-full max-w-md rounded-2xl bg-[color:var(--a-surface-strong)] p-5 shadow-[var(--a-shadow)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="create-family-title"
                className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]"
              >
                创建家族档案
              </h2>
              <p className="mt-2 text-sm text-[color:var(--a-muted)]">
                新建家族默认仅家族成员可见。
              </p>
              {error ? (
                <p className="mt-3 alpha-alert alpha-alert-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="fam-name" className="alpha-label">
                    家族名称 *
                  </label>
                  <input
                    ref={nameInputRef}
                    id="fam-name"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="例如：赵氏家庭"
                    className="alpha-input"
                  />
                </div>
                <div>
                  <label htmlFor="fam-surname" className="alpha-label">
                    姓氏（可选）
                  </label>
                  <input
                    id="fam-surname"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    placeholder="例如：赵"
                    className="alpha-input"
                  />
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="alpha-btn alpha-btn-secondary flex-1"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="alpha-btn alpha-btn-primary flex-1"
                >
                  {busy ? "创建中…" : "创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
