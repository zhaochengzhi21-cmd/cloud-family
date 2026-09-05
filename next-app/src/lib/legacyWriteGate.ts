/**
 * Legacy V0 write/feature gate — CF-PROD-FREEZE-001 / 001A
 *
 * Production: fail-closed (disabled unless LEGACY_WRITES_ENABLED=true).
 * Preview / local: enabled by default (set LEGACY_WRITES_ENABLED=false to freeze).
 *
 * Security boundary is server-side. Client helpers are UX only.
 */
import { NextResponse } from "next/server";

export const LEGACY_WRITE_FROZEN_CODE = "LEGACY_WRITES_FROZEN";

/** Unified Production upgrade copy (CF-PROD-FREEZE-001A). */
export const LEGACY_WRITE_FROZEN_MESSAGE =
  "云族谱正在升级数据保护与长期保存架构，该功能暂时关闭。已有家族资料仍可正常查看。";

export const LEGACY_UPGRADE_TITLE = "功能升级中";

export const LEGACY_UPGRADE_BODY = LEGACY_WRITE_FROZEN_MESSAGE;

export const LEGACY_FEATURE_UPGRADING = "功能升级中";

/**
 * Whether legacy mutation / private management paths may run.
 * Prefer NEXT_PUBLIC_LEGACY_WRITES_ENABLED (injected at build via next.config).
 */
export function isLegacyWriteEnabled(): boolean {
  const pub = process.env.NEXT_PUBLIC_LEGACY_WRITES_ENABLED;
  if (pub === "true") return true;
  if (pub === "false") return false;

  if (process.env.VERCEL_ENV === "production") {
    return process.env.LEGACY_WRITES_ENABLED === "true";
  }
  return process.env.LEGACY_WRITES_ENABLED !== "false";
}

export function isLegacyWriteFrozen(): boolean {
  return !isLegacyWriteEnabled();
}

/** Returns a 503 response when frozen; otherwise null. */
export function assertLegacyWriteEnabled(): NextResponse | null {
  if (isLegacyWriteEnabled()) return null;
  return NextResponse.json(
    {
      success: false,
      code: LEGACY_WRITE_FROZEN_CODE,
      error: LEGACY_WRITE_FROZEN_MESSAGE,
    },
    { status: 503 }
  );
}
