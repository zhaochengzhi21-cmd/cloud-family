"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMPTY_FAMILIES, PRODUCT } from "@/v1/ui/copy";
import {
  userMessageForApiError,
  v1api,
} from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";

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
      <p className="py-12 text-center text-[#8a6a4a]" role="status">
        正在读取你的家族档案…
      </p>
    );
  }

  return (
    <div className="py-4">
      <h1 className="text-2xl font-bold text-[#5c2018]">我的家族</h1>
      <p className="mt-1 text-sm text-[#8a6a4a]">
        管理你参与的{PRODUCT.family}
      </p>

      {error ? (
        <p className="mt-4 rounded-xl bg-[#f8ece8] px-3 py-2 text-sm text-[#7a1f1f]" role="alert">
          {error}
        </p>
      ) : null}

      {families && families.length === 0 && !creating ? (
        <div className="mt-10 rounded-2xl border border-dashed border-[#d4a76a]/50 bg-white/60 px-5 py-10 text-center">
          <h2 className="text-xl font-bold text-[#5c2018]">{EMPTY_FAMILIES.title}</h2>
          <p className="mt-3 text-base leading-relaxed text-[#6b5344]">
            {EMPTY_FAMILIES.body}
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#7a1f1f] px-5 text-base font-bold text-white"
          >
            {EMPTY_FAMILIES.cta}
          </button>
        </div>
      ) : null}

      {families && families.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {families.map((f) => (
            <li key={f.id}>
              <Link
                href={`/alpha/families/${f.id}`}
                className="flex min-h-[56px] items-center justify-between rounded-2xl border border-[#d4a76a]/30 bg-white/80 px-4 py-3 hover:border-[#7a1f1f]/40"
              >
                <div>
                  <p className="font-bold text-[#5c2018]">{f.displayName}</p>
                  {f.surname ? (
                    <p className="text-sm text-[#8a6a4a]">{f.surname}</p>
                  ) : null}
                </div>
                <span className="text-sm text-[#8a6a4a]">打开</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#7a1f1f]"
            >
              + 创建家族档案
            </button>
          </li>
        </ul>
      ) : null}

      {creating ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-family-title"
        >
          <form
            onSubmit={onCreate}
            className="w-full max-w-md rounded-2xl bg-[#faf7f2] p-5 shadow-xl"
          >
            <h2 id="create-family-title" className="text-lg font-bold text-[#5c2018]">
              创建家族档案
            </h2>
            <p className="mt-2 text-sm text-[#6b5344]">
              新建家族默认仅家族成员可见。
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="fam-name" className="mb-1 block text-sm font-semibold">
                  家族名称 *
                </label>
                <input
                  id="fam-name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例如：赵氏家庭"
                  className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3 outline-none focus:border-[#7a1f1f]"
                />
              </div>
              <div>
                <label htmlFor="fam-surname" className="mb-1 block text-sm font-semibold">
                  姓氏（可选）
                </label>
                <input
                  id="fam-surname"
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  placeholder="例如：赵"
                  className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3 outline-none focus:border-[#7a1f1f]"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="min-h-[44px] flex-1 rounded-xl border border-[#d4a76a]/40 font-semibold"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] flex-1 rounded-xl bg-[#7a1f1f] font-bold text-white disabled:opacity-60"
              >
                {busy ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
