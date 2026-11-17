"use client";

import { useEffect, useState } from "react";

/** Sticky notice when the browser reports offline — Alpha is network-backed. */
export function AlphaConnectivityBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;

  return (
    <div
      className="alpha-print-hide border-b border-[color:var(--a-brand-line)] bg-[color:var(--a-warn-soft)] px-4 py-2.5 text-center text-sm text-[color:var(--a-ink)]"
      role="status"
      aria-live="polite"
    >
      网络已断开。你可以继续查看已打开的内容；保存与刷新需恢复网络后重试。
    </div>
  );
}
