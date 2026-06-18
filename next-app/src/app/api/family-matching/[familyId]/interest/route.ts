/**
 * 匹配兴趣 API
 *
 * POST: 标记/取消"我有兴趣"
 * GET: 检查与某个目标家族的互相兴趣状态
 */

import { NextRequest, NextResponse } from "next/server";
import { getFamilyMeta } from "@/lib/familyStore";
import {
  expressInterest,
  withdrawInterest,
  getInterest,
  checkMutualInterest,
  establishConnection,
  getConnection,
} from "@/lib/matchingStore";

/**
 * POST /api/family-matching/[familyId]/interest
 *
 * Body:
 *   { targetFamilyId: string, action: "express" | "withdraw", targetFamilyName?: string }
 *
 * 当双方都标记"我有兴趣"后自动建立连接
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const { targetFamilyId, action, targetFamilyName } = await request.json();

    if (!targetFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少目标家族ID" },
        { status: 400 }
      );
    }

    // 验证当前家族元数据
    const currentMeta = await getFamilyMeta(familyId);
    if (!currentMeta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族数据" },
        { status: 404 }
      );
    }

    // 验证目标家族元数据
    const targetMeta = await getFamilyMeta(targetFamilyId);
    if (!targetMeta) {
      return NextResponse.json(
        { success: false, error: "未找到目标家族数据" },
        { status: 404 }
      );
    }

    // 验证当前用户身份（通过 cookie）
    const cookieToken = request.cookies.get("token")?.value;
    if (!cookieToken) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 从 auth/me 获取 emailHash
    const authRes = await fetch(
      `${request.nextUrl.protocol}//${request.nextUrl.host}/api/auth/me`,
      { headers: { cookie: request.headers.get("cookie") || "" } }
    );
    const authData = await authRes.json();
    if (!authData.success || !authData.data?.emailHash) {
      return NextResponse.json(
        { success: false, error: "无法验证用户身份" },
        { status: 401 }
      );
    }
    const emailHash = authData.data.emailHash;

    if (action === "express") {
      // 标记"我有兴趣"
      await expressInterest(familyId, targetFamilyId, emailHash);

      // 检查是否双方都标记了兴趣
      const mutual = await checkMutualInterest(familyId, targetFamilyId);
      let connection = null;

      if (mutual) {
        // 检查是否已经有连接
        const existingConnection = await getConnection(familyId, targetFamilyId);
        if (!existingConnection) {
          // 建立连接
          await establishConnection(
            familyId,
            targetFamilyId,
            currentMeta.familyName,
            targetMeta.familyName
          );
          connection = {
            familyIdA: familyId,
            familyIdB: targetFamilyId,
            familyAName: currentMeta.familyName,
            familyBName: targetMeta.familyName,
            connectedAt: new Date().toISOString(),
          };
        } else {
          connection = {
            familyIdA: existingConnection.familyIdA,
            familyIdB: existingConnection.familyIdB,
            familyAName: existingConnection.familyAName,
            familyBName: existingConnection.familyBName,
            connectedAt: existingConnection.connectedAt,
          };
        }
      }

      return NextResponse.json({
        success: true,
        interested: true,
        mutual,
        connection,
      });
    } else if (action === "withdraw") {
      // 取消兴趣
      await withdrawInterest(familyId, targetFamilyId);
      return NextResponse.json({ success: true, interested: false });
    }

    return NextResponse.json(
      { success: false, error: "无效的操作" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[matching-interest] API error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/family-matching/[familyId]/interest?targetFamilyId=xxx
 *
 * 获取与目标家族的互相兴趣状态
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const targetFamilyId = request.nextUrl.searchParams.get("targetFamilyId");

    if (!targetFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少目标家族ID" },
        { status: 400 }
      );
    }

    // 获取兴趣状态
    const myInterest = await getInterest(familyId, targetFamilyId);
    const theirInterest = await getInterest(targetFamilyId, familyId);
    const mutual = await checkMutualInterest(familyId, targetFamilyId);
    const connection = await getConnection(familyId, targetFamilyId);

    return NextResponse.json({
      success: true,
      iAmInterested: !!myInterest?.iAmInterested,
      theyAreInterested: !!theirInterest?.iAmInterested,
      mutual,
      connected: !!connection?.active,
      connection: connection?.active ? {
        familyIdA: connection.familyIdA,
        familyIdB: connection.familyIdB,
        familyAName: connection.familyAName,
        familyBName: connection.familyBName,
        connectedAt: connection.connectedAt,
      } : null,
    });
  } catch (err) {
    console.error("[matching-interest] GET error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}