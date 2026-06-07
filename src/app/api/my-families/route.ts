import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

/**
 * 家族关联数据文件路径
 */
const DATA_DIR = path.join(process.cwd(), "data");
const FAMILIES_FILE = path.join(DATA_DIR, "families.json");
const FAMILIES_META_FILE = path.join(DATA_DIR, "families-meta.json");

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
 * 家族元数据接口
 */
interface FamilyMeta {
  familyId: string;
  familyName: string;
  creatorEmailHash: string;
  editors: string[];
  createdAt: string;
  searchable?: boolean;
  memberCount?: number;
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
 * 读取家族元数据
 */
function readFamiliesMeta(): FamilyMeta[] {
  try {
    if (!fs.existsSync(FAMILIES_META_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(FAMILIES_META_FILE, "utf-8");
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

    // 读取所有关联记录（谁创建了哪些家族）
    const allFamilies = readFamilies();
    // 读取所有元数据（包含创建者和编辑者信息）
    const allMeta = readFamiliesMeta();

    // 创建家族ID到元数据的映射
    const metaMap = new Map<string, FamilyMeta>();
    for (const meta of allMeta) {
      metaMap.set(meta.familyId, meta);
    }

    // 收集用户创建或编辑的家族ID（去重）
    const seenFamilyIds = new Set<string>();

    // 1. 用户创建的家族
    const createdFamilies = allFamilies
      .filter((f) => f.emailHash === emailHash)
      .filter((f) => {
        if (seenFamilyIds.has(f.familyId)) return false;
        seenFamilyIds.add(f.familyId);
        return true;
      })
      .map((f) => {
        const meta = metaMap.get(f.familyId);
        return {
          familyId: f.familyId,
          familyName: f.familyName,
          createdAt: f.createdAt,
          role: "creator" as const,
          memberCount: meta?.memberCount ?? 0,
        };
      });

    // 2. 用户作为编辑者参与的家族
    const editedFamilies = allMeta
      .filter((meta) => meta.editors.includes(emailHash))
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