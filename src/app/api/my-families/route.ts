import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

/**
 * 家族关联数据文件路径
 */
const DATA_DIR = path.join(process.cwd(), "data");
const FAMILIES_FILE = path.join(DATA_DIR, "families.json");

/** JWT 密钥（与 auth/route.ts 保持一致） */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/**
 * 家族关联记录接口
 */
interface FamilyRecord {
  emailHash: string;
  familyId: string;
  familyName: string;
  createdAt: string;
}

/**
 * 读取家族关联数据
 */
function readFamilies(): FamilyRecord[] {
  try {
    if (!fs.existsSync(FAMILIES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(FAMILIES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

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
 * 获取当前登录用户关联的家族列表
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

    const allFamilies = readFamilies();
    const myFamilies = allFamilies.filter((f) => f.emailHash === emailHash);

    // 按创建时间倒序排列（最新在前）
    myFamilies.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      success: true,
      families: myFamilies.map((f) => ({
        familyId: f.familyId,
        familyName: f.familyName,
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    console.error("my-families API error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}