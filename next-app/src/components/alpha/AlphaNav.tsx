"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRODUCT } from "@/v1/ui/copy";
import { v1api, V1ApiError } from "@/v1/client/api";

function clearAlphaSessionStorage() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("alpha-")) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}

export function AlphaNav() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const hideNav = pathname.startsWith("/alpha/login");
  const [loggingOut, setLoggingOut] = useState(false);

  if (hideNav) return null;

  async function onLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await v1api.logout();
    } catch {
      /* still leave */
    }
    clearAlphaSessionStorage();
    router.replace("/alpha/login");
  }

  return (
    <header className="alpha-nav">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/alpha/families"
          className="alpha-font-display text-lg font-bold tracking-wide text-[color:var(--a-brand)]"
        >
          {PRODUCT.brand}
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3">
          <Link
            href="/alpha/families"
            aria-current={
              pathname === "/alpha/families" ||
              pathname.startsWith("/alpha/families/")
                ? "page"
                : undefined
            }
            className={`inline-flex min-h-[44px] items-center px-2 text-sm font-semibold hover:text-[color:var(--a-brand)] ${
              pathname === "/alpha/families" ||
              pathname.startsWith("/alpha/families/")
                ? "text-[color:var(--a-brand)]"
                : "text-[color:var(--a-ink)]"
            }`}
          >
            我的家族
          </Link>
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => void onLogout()}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
          >
            {loggingOut ? "退出中…" : "退出"}
          </button>
        </nav>
      </div>
    </header>
  );
}

export function handleAuthRedirect(
  e: unknown,
  router: { replace: (h: string) => void }
) {
  if (e instanceof V1ApiError && e.status === 401) {
    const q = new URLSearchParams({ reason: "expired" });
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      if (
        next.startsWith("/alpha/") &&
        !next.startsWith("/alpha/login")
      ) {
        q.set("next", next);
      }
    } catch {
      /* non-browser */
    }
    router.replace(`/alpha/login?${q.toString()}`);
    return true;
  }
  return false;
}
