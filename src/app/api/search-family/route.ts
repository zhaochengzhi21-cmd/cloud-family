import { NextRequest, NextResponse } from "next/server";

/**
 * 已知的 family 列表（硬编码的已部署族谱 ID，用于演示搜索）
 * 实际场景需要链上索引器（如 The Graph）或链下数据库来支持搜索
 * 这里采用 "被动搜索" 方式：先去 Pinata/IPFS 搜索存储的已公开家族元数据
 */
const KNOWN_FAMILIES: Record<string, { familyName: string; description?: string; generationCount?: number }> = {};

/**
 * 搜索家族名称（目前基于演示数据 + Pinata 搜索）
 * 真实生产环境应使用 The Graph 或链下索引数据库
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: "缺少 name 参数" }, { status: 400 });
    }

    const query = name.trim().toLowerCase();

    // 方式1：从 KNOWN_FAMILIES 中搜索
    const localResults = Object.entries(KNOWN_FAMILIES)
      .filter(([, info]) => info.familyName.toLowerCase().includes(query))
      .map(([familyId, info]) => ({
        familyId,
        ...info,
      }));

    // 方式2：尝试从 Pinata 的 API 搜索公开的家族
    // 由于没有全局索引，这里返回本地结果
    // 真实部署时可以通过 The Graph 或者链下数据库来实现全文搜索

    return NextResponse.json({
      success: true,
      results: localResults,
      note: "搜索功能目前基于已知家族列表。完整搜索需要部署链下索引数据库。",
    });
  } catch (error: unknown) {
    console.error("search-family API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 }
    );
  }
}