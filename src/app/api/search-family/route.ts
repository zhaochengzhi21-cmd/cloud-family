import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FAMILIES_META_FILE = path.join(DATA_DIR, "families-meta.json");

/**
 * 从本地元数据中搜索公开（searchable: true）的家族
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: "缺少 name 参数" }, { status: 400 });
    }

    const query = name.trim().toLowerCase();

    // 从 families-meta.json 中读取数据
    let results: Array<{
      familyId: string;
      familyName: string;
      description?: string;
      generationCount?: number;
      memberCount?: number;
      createdAt?: string;
    }> = [];

    if (fs.existsSync(FAMILIES_META_FILE)) {
      try {
        const raw = fs.readFileSync(FAMILIES_META_FILE, "utf-8");
        const metaList = JSON.parse(raw);
        if (Array.isArray(metaList)) {
          results = metaList
            .filter((m: Record<string, unknown>) => {
              // 只返回 searchable 为 true 的家族
              return m.searchable === true && typeof m.familyName === "string" &&
                (m.familyName as string).toLowerCase().includes(query);
            })
            .map((m: Record<string, unknown>) => ({
              familyId: m.familyId as string,
              familyName: m.familyName as string,
              memberCount: typeof m.memberCount === "number" ? m.memberCount : undefined,
              createdAt: m.createdAt as string | undefined,
            }));
        }
      } catch (e) {
        console.error("search-family: error reading meta file", e);
      }
    }

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
