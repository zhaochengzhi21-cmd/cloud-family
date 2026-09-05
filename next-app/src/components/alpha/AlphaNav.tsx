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
    <header className="sticky top-0 z-30 border-b border-[#d4a76a]/25 bg-[#faf7f2]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/alpha/families"
          className="text-lg font-bold tracking-wide text-[#7a1f1f]"
        >
          {PRODUCT.brand}
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/alpha/families"
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-[#5c3a2e] hover:text-[#7a1f1f]"
          >
            我的家族
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-[#d4a76a]/40 px-3 text-sm font-semibold text-[#8a6a4a] hover:border-[#7a1f1f]/40 hover:text-[#7a1f1f]"
          >
            退出
          </button>
        </nav>
      </div>
    </header>
  );
}

export function handleAuthRedirect(e: unknown, router: { replace: (h: string) => void }) {
  if (e instanceof V1ApiError && e.status === 401) {
    router.replace("/alpha/login?reason=expired");
    return true;
  }
  return false;
}
