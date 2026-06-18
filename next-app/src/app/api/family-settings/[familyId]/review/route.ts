import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getFamilyMeta } from "@/lib/familyStore";
import { getKv } from "@/lib/kvClient";

/** JWT 密钥 */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** 家族元数据接口（从 KV 读取的结构） */
interface FamilyMeta {
  familyId: string;
  familyName: string;
  creatorEmailHash: string;
  editors: string[];
  createdAt: string;
}

/** 申请记录接口 */
interface ApplyRecord {
  familyId: string;
  applicantHash: string;
  /** 脱敏邮箱用于展示 */
  maskedEmail: string;
  appliedAt: string;
  status: "pending" | "approved" | "rejected";
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
 * 审核编辑权限申请
 *
 * PATCH /api/family-settings/[familyId]/review
 * 需要 JWT 认证（仅创建者可操作）
 * Body:
 *   - { applicantHash: string, action: "approve" | "reject" }
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
    const body: { applicantHash?: string; action?: "approve" | "reject" } = await request.json();

    if (!body.applicantHash || !body.action) {
      return NextResponse.json(
        { success: false, error: "请提供 applicantHash 和 action" },
        { status: 400 }
      );
    }

    if (body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json(
        { success: false, error: "action 必须为 approve 或 reject" },
        { status: 400 }
      );
    }

    // 获取家族元数据
    const kv = getKv();
    const metaKey = `family:meta:${familyId}`;
    const meta = await kv.get<FamilyMeta>(metaKey);

    if (!meta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族信息" },
        { status: 404 }
      );
    }

    // 仅创建者可审核
    if (meta.creatorEmailHash !== emailHash) {
      return NextResponse.json(
        { success: false, error: "仅创建者可审核申请" },
        { status: 403 }
      );
    }

    // 查找申请记录
    const applyKey = `family:apply:${familyId}:${body.applicantHash}`;
    const applyRecord = await kv.get<ApplyRecord>(applyKey);

    if (!applyRecord) {
      return NextResponse.json(
        { success: false, error: "未找到该申请记录" },
        { status: 404 }
      );
    }

    if (applyRecord.status !== "pending") {
      return NextResponse.json(
        { success: false, error: "该申请已被审核，无法重复操作" },
        { status: 400 }
      );
    }

    if (body.action === "approve") {
      // 通过申请：将申请人添加到编辑者列表
      if (!meta.editors.includes(body.applicantHash)) {
        meta.editors.push(body.applicantHash);
      }
      await kv.set(metaKey, meta);

      // 更新申请记录状态
      applyRecord.status = "approved";
      await kv.set(applyKey, applyRecord);

      return NextResponse.json({
        success: true,
        message: "已通过申请，该用户已成为编辑者",
        editors: meta.editors,
      });
    } else {
      // 拒绝申请
      applyRecord.status = "rejected";
      await kv.set(applyKey, applyRecord);

      return NextResponse.json({
        success: true,
        message: "已拒绝该申请",
        editors: meta.editors,
      });
    }
  } catch (err) {
    console.error("family-settings review PATCH error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}