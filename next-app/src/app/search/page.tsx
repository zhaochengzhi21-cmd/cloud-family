"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ---------- 类型 ----------
interface SearchResult {
  familyName: string;
  familyId: string;
  description?: string;
  generationCount?: number;
}

interface SearchApiResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
}

// ---------- 主页面 ----------
export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setSearching(true);
    setSearched(true);

    try {
      const res = await fetch(`/api/search-family?name=${encodeURIComponent(q)}`);
      const data: SearchApiResponse = await res.json();

      if (!data.success) {
        setResults([]);
      } else {
        setResults(data.results || []);
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#fdfbf7] via-[#f8f4ec] to-[#f0e8d8]">
      {/* 顶部装饰线条 */}
      <div className="h-2 bg-gradient-to-r from-[#8b0000] via-[#a52a2a] to-[#8b0000]" />

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* 标题 */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-4 mb-4">
            <Link
              href="/"
              className="text-sm text-[#5c3a2e] hover:text-[#8b0000] transition-colors"
            >
              ← 返回首页
            </Link>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-[#8b0000] tracking-wider mb-3">
            🔍 查找已有家族
          </h1>
          <p className="text-[#5c3a2e]/60 text-sm tracking-wider">
            输入家族名称，查找已公开的家族谱系
          </p>
        </div>

        {/* 搜索框 */}
        <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8 mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="请输入家族名称（如：张氏家族）"
              className="flex-1 px-4 py-3 bg-[#fdfbf7] border-2 border-[#d4a76a]/50 rounded-xl text-lg text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:border-[#8b0000] focus:ring-2 focus:ring-[#8b0000]/20 transition-all duration-300"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-8 py-3 rounded-xl text-lg font-bold tracking-wider bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {searching ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  搜索中...
                </span>
              ) : (
                "搜索"
              )}
            </button>
          </div>
        </div>

        {/* 搜索结果 */}
        {searched && (
          <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8">
            {searching ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 mx-auto border-2 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin mb-3" />
                <p className="text-[#5c3a2e]">正在搜索...</p>
              </div>
            ) : results && results.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-[#5c3a2e]/60 mb-4">
                  找到 {results.length} 个结果
                </p>
                {results.map((result) => (
                  <Link
                    key={result.familyId}
                    href={`/family/${result.familyId}`}
                    className="block group"
                  >
                    <div className="bg-[#fdfbf7] border border-[#d4a76a]/30 rounded-xl p-5 hover:border-[#8b0000]/30 hover:shadow-md transition-all duration-300">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-xl font-bold text-[#8b0000] group-hover:text-[#a52a2a] transition-colors">
                            {result.familyName}
                          </h3>
                          {result.description && (
                            <p className="text-sm text-[#5c3a2e]/70 mt-1">
                              {result.description}
                            </p>
                          )}
                        </div>
                        {result.generationCount !== undefined && (
                          <span className="text-sm text-[#c4a67a] whitespace-nowrap ml-4">
                            共 {result.generationCount} 代
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-[#c4a67a]">
                        <span>查看详情 →</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">📭</div>
                <p className="text-lg font-bold text-[#5c3a2e] mb-2">
                  未找到匹配的家族
                </p>
                <p className="text-sm text-[#c4a67a]">
                  请检查名称是否正确，或尝试其他关键词
                </p>
              </div>
            )}
          </div>
        )}

        {/* 未搜索时的提示 */}
        {!searched && (
          <div className="bg-[#fdfbf7] border-2 border-dashed border-[#d4a76a]/40 rounded-2xl p-12 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-lg font-bold text-[#5c3a2e] tracking-wider mb-2">
              搜索公开的家族谱系
            </p>
              <p className="text-sm text-[#c4a67a]">
              只有创建者主动设置为{'"允许被搜索"'}的家族才会出现在搜索结果中
            </p>
          </div>
        )}
      </div>
    </div>
  );
}