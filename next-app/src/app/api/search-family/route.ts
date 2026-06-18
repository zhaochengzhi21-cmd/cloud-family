import { NextRequest, NextResponse } from "next/server";
import { getAllFamilyMeta } from "@/lib/familyStore";

/**
 * 从 KV/Redis 中搜索公开（searchable: true）的家族
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: "缺少 name 参数" }, { status: 400 });
    }

    const query = name.trim().toLowerCase();

    // 从 KV 获取所有家族元数据
    const allMeta = await getAllFamilyMeta();
    const results = allMeta
      .filter((m) => {
        // 只返回 searchable 为 true 且名字匹配的家族
        return m.searchable === true && m.familyName.toLowerCase().includes(query);
      })
      .map((m) => ({
        familyId: m.familyId,
        familyName: m.familyName,
        memberCount: typeof m.memberCount === "number" ? m.memberCount : undefined,
        createdAt: m.createdAt,
      }));

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error: unknown) {
    console.error("search-family API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 }
    );
  }
}
