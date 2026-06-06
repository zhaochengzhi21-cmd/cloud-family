import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/** JWT 密钥 */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** 家族元数据文件路径 */
const DATA_DIR = path.join(process.cwd(), "data");
const FAMILIES_META_FILE = path.join(DATA_DIR, "families-meta.json");

/** 家族元数据接口 */
interface FamilyMeta {
  familyId: string;
  familyName: string;
  /** 创建者邮箱哈希 */
  creatorEmailHash: string;
  /** 受邀编辑者邮箱哈希列表 */
  editors: string[];
  createdAt: string;
}

/**
 * 读取所有家族元数据
 */
function readAllMeta(): FamilyMeta[] {
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
 * 写入所有家族元数据
 */
function writeAllMeta(metaList: FamilyMeta[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FAMILIES_META_FILE, JSON.stringify(metaList, null, 2), "utf-8");
  } catch (err) {
    console.error("writeAllMeta error:", err);
  }
}

/**
 * 获取单个家族的元数据
 */
function getFamilyMeta(familyId: string): FamilyMeta | undefined {
  const allMeta = readAllMeta();
  return allMeta.find((m) => m.familyId === familyId);
}

/**
 * 从请求中解析 JWT token 并获取 emailHash
 */
function getEmailHashFromRequest(request: NextRequest): string | null {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
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
 * 获取家族设置信息
 *
 * GET /api/family-settings/[familyId]
 * 需要 JWT 认证
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;

    const emailHash = getEmailHashFromRequest(request);
    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    const meta = getFamilyMeta(familyId);

    if (!meta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的设置信息" },
        { status: 404 }
      );
    }

    // 只有创建者和编辑者可以查看家族设置
    const isCreator = meta.creatorEmailHash === emailHash;
    const isEditor = meta.editors.includes(emailHash);

    return NextResponse.json({
      success: true,
      creatorEmailHash: meta.creatorEmailHash,
      editors: meta.editors,
      isCreator,
      isEditor,
      canEdit: isCreator || isEditor,
    });
  } catch (err) {
    console.error("family-settings GET error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * 更新家族设置（邀请编辑者）
 *
 * PATCH /api/family-settings/[familyId]
 * 需要 JWT 认证（仅创建者可操作）
 * Body: { email: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;

    const emailHash = getEmailHashFromRequest(request);
    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    // 解析请求体
    const body: { email?: string; removeEditorEmailHash?: string } = await request.json();

    const allMeta = readAllMeta();
    const metaIndex = allMeta.findIndex((m) => m.familyId === familyId);

    if (metaIndex === -1) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的设置信息" },
        { status: 404 }
      );
    }

    const meta = allMeta[metaIndex];

    // 仅创建者可修改设置
    if (meta.creatorEmailHash !== emailHash) {
      return NextResponse.json(
        { success: false, error: "仅创建者可管理编辑者" },
        { status: 403 }
      );
    }

    // 添加编辑者
    if (body.email) {
      const inviteEmailHash = calculateEmailHash(body.email.trim().toLowerCase());

      if (inviteEmailHash === meta.creatorEmailHash) {
        return NextResponse.json(
          { success: false, error: "不能将创建者自己添加为编辑者" },
          { status: 400 }
        );
      }

      if (meta.editors.includes(inviteEmailHash)) {
        return NextResponse.json(
          { success: false, error: "该用户已是编辑者" },
          { status: 400 }
        );
      }

      meta.editors.push(inviteEmailHash);
      allMeta[metaIndex] = meta;
      writeAllMeta(allMeta);

      return NextResponse.json({
        success: true,
        message: "邀请成功！对方登录后即可编辑该家族",
        editors: meta.editors,
      });
    }

    // 移除编辑者
    if (body.removeEditorEmailHash) {
      const idx = meta.editors.indexOf(body.removeEditorEmailHash);
      if (idx === -1) {
        return NextResponse.json(
          { success: false, error: "该用户不是编辑者" },
          { status: 400 }
        );
      }
      meta.editors.splice(idx, 1);
      allMeta[metaIndex] = meta;
      writeAllMeta(allMeta);

      return NextResponse.json({
        success: true,
        message: "已移除编辑者",
        editors: meta.editors,
      });
    }

    return NextResponse.json(
      { success: false, error: "请提供 email 或 removeEditorEmailHash" },
      { status: 400 }
    );
  } catch (err) {
    console.error("family-settings PATCH error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * 工具函数：计算邮箱哈希（与 auth/route.ts 一致）
 */
function calculateEmailHash(email: string): string {
  // 使用简单的 SHA-256 哈希
  return crypto.createHash("sha256").update(email).digest("hex");
}
