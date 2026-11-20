"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMPTY_FAMILIES, PRODUCT, ROLE_LABEL } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";
import { useFocusTrap } from "@/components/alpha/useFocusTrap";

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
  const [surnameTouched, setSurnameTouched] = useState(false);
  const [lastFamilyId, setLastFamilyId] = useState("");
  const [leftNote, setLeftNote] = useState("");
  const [leftNoteCopyFlash, setLeftNoteCopyFlash] = useState("");
  const [emptyCopyFlash, setEmptyCopyFlash] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const createDialogRef = useRef<HTMLDivElement>(null);

  const closeCreate = useCallback(() => {
    if (!busy) setCreating(false);
  }, [busy]);

  const openCreate = useCallback(() => {
    setDisplayName("");
    setSurname("");
    setSurnameTouched(false);
    setError("");
    setCreating(true);
  }, []);

  useFocusTrap(createDialogRef, closeCreate, nameInputRef, creating);

  useEffect(() => {
    if (!creating) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [creating]);

  useEffect(() => {
    try {
      setLastFamilyId(sessionStorage.getItem("alpha-last-family") ?? "");
    } catch {
      setLastFamilyId("");
    }
  }, [families]);

  useEffect(() => {
    try {
      const note = sessionStorage.getItem("alpha-left-family-note");
      if (!note) return;
      sessionStorage.removeItem("alpha-left-family-note");
      setLeftNote(note);
    } catch {
      /* private mode */
    }
  }, []);

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
    return list.slice().sort((a, b) => {
      if (lastFamilyId) {
        if (a.id === lastFamilyId) return -1;
        if (b.id === lastFamilyId) return 1;
      }
      return a.displayName.localeCompare(b.displayName, "zh-CN");
    });
  }, [families, query, lastFamilyId]);

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

      {leftNote ? (
        <div
          className="mb-4 flex flex-wrap items-start justify-between gap-3 alpha-alert alpha-alert-ok"
          role="status"
        >
          <p className="min-w-0 flex-1">{leftNote}</p>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {leftNote.includes("可复制") ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  const url = `${window.location.origin}/alpha/families`;
                  void navigator.clipboard.writeText(url).then(
                    () => {
                      setLeftNoteCopyFlash("已复制链接");
                      window.setTimeout(() => setLeftNoteCopyFlash(""), 2500);
                    },
                    () => {
                      setLeftNoteCopyFlash("请手动复制地址栏链接");
                      window.setTimeout(() => setLeftNoteCopyFlash(""), 2500);
                    }
                  );
                }}
              >
                {leftNoteCopyFlash || "复制链接"}
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
              onClick={() => {
                setLeftNote("");
                setLeftNoteCopyFlash("");
              }}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}

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
            onClick={openCreate}
            className="alpha-btn alpha-btn-primary mt-8"
          >
            {EMPTY_FAMILIES.cta}
          </button>
          <p className="mt-4 text-sm text-[color:var(--a-muted)]">
            已有邀请？打开家人发来的邀请链接即可加入（登录页邀请码用于内测注册，不是家族邀请）。
          </p>
          <button
            type="button"
            className="mt-3 text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
            onClick={() => {
              const url = `${window.location.origin}/alpha/families`;
              void navigator.clipboard.writeText(url).then(
                () => {
                  setEmptyCopyFlash("已复制「我的家族」链接，可发给家人对照");
                  window.setTimeout(() => setEmptyCopyFlash(""), 2500);
                },
                () => {
                  setEmptyCopyFlash("请手动复制地址栏链接");
                  window.setTimeout(() => setEmptyCopyFlash(""), 2500);
                }
              );
            }}
          >
            {emptyCopyFlash || "复制本页链接发给家人"}
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
          {query.trim() && filtered.length > 0 ? (
            <p
              className="mb-3 text-sm text-[color:var(--a-muted)]"
              aria-live="polite"
            >
              显示 {filtered.length} / {families.length} 个家族
              <button
                type="button"
                className="ml-2 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => setQuery("")}
              >
                清除筛选
              </button>
            </p>
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
                          f.id === lastFamilyId ? "最近打开" : null,
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
            onClick={openCreate}
            className="alpha-btn alpha-btn-ghost mt-3 !justify-start !px-0"
          >
            + 创建家族档案
          </button>
        </div>
      ) : null}

      {creating ? (
        <div
          ref={createDialogRef}
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
                新建家族默认{PRODUCT.privacyFamilyOnly}。
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
                    onChange={(e) => {
                      const next = e.target.value;
                      setDisplayName(next);
                      if (!surnameTouched) {
                        const t = next.trim();
                        setSurname(t ? t.charAt(0) : "");
                      }
                    }}
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
                    onChange={(e) => {
                      setSurnameTouched(true);
                      setSurname(e.target.value);
                    }}
                    placeholder="例如：赵"
                    className="alpha-input"
                  />
                  {!surnameTouched && surname ? (
                    <p className="mt-1.5 text-xs text-[color:var(--a-muted)]">
                      已根据家族名称预填姓氏，可直接修改。
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={closeCreate}
                  disabled={busy}
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
