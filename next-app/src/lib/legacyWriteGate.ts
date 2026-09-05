/**
 * Legacy V0 write gate — CF-PROD-FREEZE-001
 *
 * Production: fail-closed (writes disabled unless LEGACY_WRITES_ENABLED=true).
 * Preview / local: writes enabled by default (set LEGACY_WRITES_ENABLED=false to freeze).
 *
 * Security boundary is server-side. Client helpers are UX only.
 */
import { NextResponse } from "next/server";

export const LEGACY_WRITE_FROZEN_CODE = "LEGACY_WRITES_FROZEN";

export const LEGACY_WRITE_FROZEN_MESSAGE =
  "云族谱正在升级数据保护能力，暂时停止新增和修改家族资料。";

export const LEGACY_UPGRADE_TITLE = "家族档案创建功能正在升级";

export const LEGACY_UPGRADE_BODY =
  "我们正在升级云族谱的数据保护与长期保存架构，新的家族创建和资料上传暂时关闭。已有家族仍可正常查看。";

export const LEGACY_FEATURE_UPGRADING = "功能升级中";

/**
 * Whether legacy write paths (save / upload / OCR / restore) may run.
 * Prefer NEXT_PUBLIC_LEGACY_WRITES_ENABLED (injected at build via next.config).
 */
export function isLegacyWriteEnabled(): boolean {
  const pub = process.env.NEXT_PUBLIC_LEGACY_WRITES_ENABLED;
  if (pub === "true") return true;
  if (pub === "false") return false;

  // Server-only fallback if public flag somehow missing
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
