import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getFamilyMeta } from "@/lib/familyStore";
import { getKv } from "@/lib/kvClient";

/** JWT 密钥 */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** 家族元数据接口（从 KV 读取的结构） */
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
 * 从请求中解析 JWT token 并获取原始 email（用于日志/通知等，可选）
 */
function getEmailFromRequest(request: NextRequest): string | null {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      const authHeader = request.headers.get("authorization");
      const tokenFromHeader = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (!tokenFromHeader) return null;
      const decoded = jwt.verify(tokenFromHeader, JWT_SECRET) as { emailHash: string; email?: string };
      return decoded.email || null;
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { emailHash: string; email?: string };
    return decoded.email || null;
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

    // 从 KV/Redis 读取家族元数据（与 save-family/route.ts 写入的数据源一致）
    const meta = await getFamilyMeta(familyId);

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
 * 更新家族设置（邀请编辑者 / 移除编辑者 / 转让创建者）
 *
 * PATCH /api/family-settings/[familyId]
 * 需要 JWT 认证（仅创建者可操作）
 * Body:
 *   - { email: string } 邀请编辑者
 *   - { removeEditorEmailHash: string } 移除编辑者
 *   - { transferCreatorEmail: string } 转让创建者
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
    const body: { email?: string; removeEditorEmailHash?: string; transferCreatorEmail?: string } = await request.json();

    // 从 KV/Redis 读取家族元数据
    const kv = getKv();
    const metaKey = `family:meta:${familyId}`;
    const meta = await kv.get<FamilyMeta>(metaKey);

    if (!meta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的设置信息" },
        { status: 404 }
      );
    }

    // 仅创建者可修改设置
    if (meta.creatorEmailHash !== emailHash) {
      return NextResponse.json(
        { success: false, error: "仅创建者可管理编辑者" },
        { status: 403 }
      );
    }

    // ========== 转让创建者 ==========
    if (body.transferCreatorEmail) {
      const newCreatorEmail = body.transferCreatorEmail.trim().toLowerCase();
      const newCreatorHash = calculateEmailHash(newCreatorEmail);

      // 验证新创建者不能是自己
      if (newCreatorHash === meta.creatorEmailHash) {
        return NextResponse.json(
          { success: false, error: "不能将创建者转让给自己" },
          { status: 400 }
        );
      }

      // 如果新创建者已在编辑者列表中，先移除
      const editorIdx = meta.editors.indexOf(newCreatorHash);
      if (editorIdx !== -1) {
        meta.editors.splice(editorIdx, 1);
      }

      // 将原创建者加入编辑者列表（如果不在的话）
      if (!meta.editors.includes(meta.creatorEmailHash)) {
        meta.editors.push(meta.creatorEmailHash);
      }

      // 更新创建者
      const oldCreatorHash = meta.creatorEmailHash;
      meta.creatorEmailHash = newCreatorHash;

      await kv.set(metaKey, meta);

      return NextResponse.json({
        success: true,
        message: "创建者转让成功",
        oldCreatorHash,
        newCreatorHash,
        editors: meta.editors,
      });
    }

    // ========== 添加编辑者 ==========
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
      await kv.set(metaKey, meta);

      return NextResponse.json({
        success: true,
        message: "邀请成功！对方登录后即可编辑该家族",
        editors: meta.editors,
      });
    }

    // ========== 移除编辑者 ==========
    if (body.removeEditorEmailHash) {
      const idx = meta.editors.indexOf(body.removeEditorEmailHash);
      if (idx === -1) {
        return NextResponse.json(
          { success: false, error: "该用户不是编辑者" },
          { status: 400 }
        );
      }
      meta.editors.splice(idx, 1);
      await kv.set(metaKey, meta);

      return NextResponse.json({
        success: true,
        message: "已移除编辑者",
        editors: meta.editors,
      });
    }

    return NextResponse.json(
      { success: false, error: "请提供 email、removeEditorEmailHash 或 transferCreatorEmail" },
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
 * auth/route.ts 的 hashEmail 使用: crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex")
 */
function calculateEmailHash(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}