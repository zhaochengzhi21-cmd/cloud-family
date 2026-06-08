import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getUserFamilies, getUserEditedFamilies } from "@/lib/familyStore";
import type { FamilyBinding, FamilyMeta } from "@/lib/familyStore";

/** JWT 密钥（与 auth/route.ts 保持一致） */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/**
 * 从请求中解析 JWT token 并获取 emailHash
 */
function getEmailHashFromRequest(request: NextRequest): string | null {
  try {
    // 尝试从 cookie 获取
    const token = request.cookies.get("token")?.value;
    if (!token) {
      // 尝试从 Authorization header 获取
      const authHeader = request.headers.get("authorization");
      const tokenFromHeader = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (!tokenFromHeader) return null;
      const decoded = jwt.verify(tokenFromHeader, JWT_SECRET) as { emailHash: string };
      return decoded.emailHash;
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { emailHash: string };
    return decoded.emailHash;
  } catch {
    return null;
  }
}

/**
 * 获取当前登录用户关联的家族列表（包括创建的和参与编辑的）
 *
 * GET /api/my-families
 * 需要 JWT cookie 或 Authorization header 认证
 */
export async function GET(request: NextRequest) {
  try {
    const emailHash = getEmailHashFromRequest(request);

    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    // 从 KV 获取用户创建和编辑的家族
    const userFamilies = await getUserFamilies(emailHash);
    const editedMeta = await getUserEditedFamilies(emailHash);

    const seenFamilyIds = new Set<string>();

    // 1. 用户创建的家族
    const createdFamilies = userFamilies
      .filter((item) => {
        if (!item.binding) return false;
        if (seenFamilyIds.has(item.binding.familyId)) return false;
        seenFamilyIds.add(item.binding.familyId);
        return true;
      })
      .map((item) => ({
        familyId: item.binding!.familyId,
        familyName: item.binding!.familyName,
        createdAt: item.binding!.createdAt,
        role: "creator" as const,
        memberCount: item.meta?.memberCount ?? 0,
      }));

    // 2. 用户作为编辑者参与的家族
    const editedFamilies = editedMeta
      .filter((meta) => {
        if (seenFamilyIds.has(meta.familyId)) return false;
        seenFamilyIds.add(meta.familyId);
        return true;
      })
      .map((meta) => ({
        familyId: meta.familyId,
        familyName: meta.familyName,
        createdAt: meta.createdAt,
        role: "editor" as const,
        memberCount: meta.memberCount ?? 0,
      }));

    // 合并并按创建时间倒序排列
    const allMyFamilies = [...createdFamilies, ...editedFamilies].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      success: true,
      families: allMyFamilies,
    });
  } catch (err) {
    console.error("my-families API error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}