"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRODUCT } from "@/v1/ui/copy";
import { v1api, V1ApiError } from "@/v1/client/api";

export function AlphaNav() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const hideNav = pathname.startsWith("/alpha/login");

  if (hideNav) return null;

  async function onLogout() {
    try {
      await v1api.logout();
    } catch {
      /* still leave */
    }
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
            onClick={onLogout}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !px-3 !text-sm"
          >
            退出
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
    router.replace("/alpha/login?reason=expired");
    return true;
  }
  return false;
}
