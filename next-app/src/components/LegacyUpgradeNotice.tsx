"use client";

import {
  LEGACY_UPGRADE_TITLE,
  LEGACY_UPGRADE_BODY,
} from "@/lib/legacyWriteGate";

/** Minimal shared upgrade notice — no redesign. */
export default function LegacyUpgradeNotice({
  title = LEGACY_UPGRADE_TITLE,
  className = "",
}: {
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[#d4a76a]/40 bg-[#fdfbf7] px-4 py-3 text-center ${className}`}
    >
      <p className="text-base font-bold text-[#8b0000] tracking-wider mb-2">{title}</p>
      <p className="text-sm text-[#5c3a2e]/80 leading-relaxed">{LEGACY_UPGRADE_BODY}</p>
    </div>
  );
}
