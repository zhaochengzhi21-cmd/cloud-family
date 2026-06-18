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
 * 从请求中解析 JWT token 并获取原始 email
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
 * 脱敏邮箱
 * "abc@example.com" → "a***@example.com"
 */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return name.charAt(0) + "***@" + domain;
}

/**
 * 提交编辑权限申请
 *
 * POST /api/family-settings/[familyId]/apply
 * 需要 JWT 认证（仅阅读者可申请）
 */
export async function POST(
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

    // 获取家族元数据
    const meta = await getFamilyMeta(familyId);
    if (!meta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族信息" },
        { status: 404 }
      );
    }

    // 安全措施：创建者不能申请
    if (meta.creatorEmailHash === emailHash) {
      return NextResponse.json(
        { success: false, error: "创建者无需申请编辑权限" },
        { status: 400 }
      );
    }

    // 安全措施：已经是编辑者不能申请
    if (meta.editors.includes(emailHash)) {
      return NextResponse.json(
        { success: false, error: "您已经是编辑者，无需申请" },
        { status: 400 }
      );
    }

    const kv = getKv();
    const applyKey = `family:apply:${familyId}:${emailHash}`;

    // 检查是否已有未审核的申请
    const existingApply = await kv.get<ApplyRecord>(applyKey);
    if (existingApply && existingApply.status === "pending") {
      return NextResponse.json(
        { success: false, error: "您已提交申请，请等待创建者审核", alreadyApplied: true },
        { status: 400 }
      );
    }

    // 如果之前被拒绝过，允许重新申请（覆盖旧的拒绝记录）
    // 获取脱敏邮箱用于展示
    const rawEmail = getEmailFromRequest(request);
    const maskedEmail = rawEmail ? maskEmail(rawEmail) : emailHash.slice(0, 8) + "***";

    const applyRecord: ApplyRecord = {
      familyId,
      applicantHash: emailHash,
      maskedEmail,
      appliedAt: new Date().toISOString(),
      status: "pending",
    };

    await kv.set(applyKey, applyRecord);

    // 同时维护一个按 familyId 索引的申请列表
    const listKey = `family:apply:list:${familyId}`;
    const existingList = await kv.get<string[]>(listKey);
    const applyList = existingList || [];
    if (!applyList.includes(emailHash)) {
      applyList.push(emailHash);
      await kv.set(listKey, applyList);
    }

    return NextResponse.json({
      success: true,
      message: "申请已提交，等待创建者审核",
    });
  } catch (err) {
    console.error("family-settings apply POST error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * 获取申请列表（用于前端创建者面板查看）
 *
 * GET /api/family-settings/[familyId]/apply
 * 需要 JWT 认证（仅创建者可查看）
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

    // 获取家族元数据
    const meta = await getFamilyMeta(familyId);
    if (!meta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族信息" },
        { status: 404 }
      );
    }

    // 仅创建者可查看申请列表
    if (meta.creatorEmailHash !== emailHash) {
      return NextResponse.json(
        { success: false, error: "仅创建者可查看申请" },
        { status: 403 }
      );
    }

    const kv = getKv();
    const listKey = `family:apply:list:${familyId}`;
    const applyList = await kv.get<string[]>(listKey);

    if (!applyList || applyList.length === 0) {
      return NextResponse.json({
        success: true,
        applications: [],
      });
    }

    // 查询每个申请的详情
    const applications: ApplyRecord[] = [];
    for (const applicantHash of applyList) {
      const record = await kv.get<ApplyRecord>(`family:apply:${familyId}:${applicantHash}`);
      if (record) {
        applications.push(record);
      }
    }

    // 按申请时间降序排列
    applications.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

    return NextResponse.json({
      success: true,
      applications,
    });
  } catch (err) {
    console.error("family-settings apply GET error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}