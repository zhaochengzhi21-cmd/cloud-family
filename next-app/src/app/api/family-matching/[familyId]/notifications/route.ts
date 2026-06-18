/**
 * 匹配通知 API
 *
 * GET: 获取当前家族是否有新的匹配结果需要通知
 * POST: 标记通知已读/关闭
 */

import { NextRequest, NextResponse } from "next/server";
import { getNewMatchResults, dismissMatchResult, getFamilyConnections } from "@/lib/matchingStore";
import { getFamilyMeta } from "@/lib/familyStore";

/**
 * GET /api/family-matching/[familyId]/notifications
 *
 * 返回新的匹配结果通知列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;

    // 获取所有未读的匹配新结果
    const newResults = await getNewMatchResults(familyId);

    // 获取当前家族元数据
    const currentMeta = await getFamilyMeta(familyId);

    // 获取已建立的连接信息
    const connections = await getFamilyConnections(familyId);

    // 为每个新结果补充家族名称
    const resultsWithMeta = await Promise.all(
      newResults.map(async (r) => {
        const meta = await getFamilyMeta(r.matchFamilyId);
        return {
          matchFamilyId: r.matchFamilyId,
          familyName: meta?.familyName || "未知家族",
          matchedAt: r.matchedAt,
        };
      })
    );

    return NextResponse.json({
      success: true,
      hasNewResults: newResults.length > 0,
      newResults: resultsWithMeta,
      currentFamilyName: currentMeta?.familyName || "",
      connections: connections.map((c) => ({
        connectedFamilyId:
          c.familyIdA === familyId ? c.familyIdB : c.familyIdA,
        connectedFamilyName:
          c.familyIdA === familyId ? c.familyBName : c.familyAName,
        connectedAt: c.connectedAt,
      })),
    });
  } catch (err) {
    console.error("[matching-notifications] GET error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/family-matching/[familyId]/notifications
 *
 * Body: { matchFamilyId: string }
 * 标记某个匹配结果通知为已关闭
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const { matchFamilyId } = await request.json();

    if (!matchFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少 matchFamilyId" },
        { status: 400 }
      );
    }

    await dismissMatchResult(familyId, matchFamilyId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[matching-notifications] POST error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}