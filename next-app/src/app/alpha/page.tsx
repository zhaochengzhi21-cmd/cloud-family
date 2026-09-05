"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { v1api } from "@/v1/client/api";

export default function AlphaRootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await v1api.me();
        if (cancelled) return;
        if (me.user?.id) router.replace("/alpha/families");
        else router.replace("/alpha/login");
      } catch {
        if (!cancelled) router.replace("/alpha/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <p className="py-16 text-center text-[#8a6a4a]" role="status">
      正在进入…
    </p>
  );
}
