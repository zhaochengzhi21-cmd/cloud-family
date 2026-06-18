"use client";

import { useState, useEffect, useCallback } from "react";

interface RevisionEntry {
  index: number;
  timestamp: string | null;
  memberCount: number | null;
  version: number | null;
  summary: string;
  expanded: boolean;
}

interface RevisionHistoryProps {
  familyId: string;
  contractAddress: string;
}

// ---------- 从 IPFS 加载元数据 ----------
async function loadIpfsRevisions(hash: string): Promise<{
  timestamp: string | null;
  memberCount: number | null;
  version: number | null;
  familyName: string | null;
}> {
  try {
    const res = await fetch(
      `https://w3s.link/ipfs/${hash}/metadata.json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      const fallbackRes = await fetch(
        `https://w3s.link/ipfs/${hash}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!fallbackRes.ok) {
        return { timestamp: null, memberCount: null, version: null, familyName: null };
      }
      const data = await fallbackRes.json();
      return extractMeta(data);
    }
    const data = await res.json();
    return extractMeta(data);
  } catch {
    return { timestamp: null, memberCount: null, version: null, familyName: null };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMeta(data: Record<string, any>): {
  timestamp: string | null;
  memberCount: number | null;
  version: number | null;
  familyName: string | null;
} {
  const timestamp =
    data.updatedAt ||
    data.timestamp ||
    null;
  const memberCount =
    data.data?.members?.length ??
    data.members?.length ??
    null;
  const version =
    data.version ??
    data.data?.version ??
    null;
  const familyName =
    data.familyName ||
    data.data?.familyName ||
    null;

  return { timestamp, memberCount, version, familyName };
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "未知时间";
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    });
  } catch {
    return ts;
  }
}

// ---------- 前端记录的时间线组件 ----------
export default function RevisionHistory({
  familyId,
}: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<RevisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!familyId) {
      setLoading(false);
      setError("家族 ID 未配置");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 从 API 获取当前 IPFS 数据
      const res = await fetch(`/api/get-family/${familyId}`);
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "获取数据失败");
        setLoading(false);
        return;
      }

      // 从当前 IPFS 数据的 metadata 提取修订信息
      const ipfsData = data.ipfsData;
      if (!ipfsData) {
        setRevisions([]);
        setLoading(false);
        return;
      }

      // 尝试从 ipfsData 中读取版修记录
      // 元数据可能包含：updatedAt, version, 或者历史记录列表 history[]
      const entries: RevisionEntry[] = [];

      // 方案1: 如果 IPFS 数据有 history 数组（提前存储的修订记录）
      if (Array.isArray(ipfsData.history)) {
        for (let i = 0; i < ipfsData.history.length; i++) {
          const h = ipfsData.history[i];
          const meta = await loadIpfsRevisions(h.hash || h);
          entries.push({
            index: i,
            timestamp: meta.timestamp || h.timestamp || null,
            memberCount: meta.memberCount ?? null,
            version: meta.version ?? h.version ?? null,
            summary: meta.familyName
              ? `${meta.familyName}`
              : `版本 ${i + 1}`,
            expanded: false,
          });
        }
      }

      // 方案2: 如果当前数据有 updatedAt 字段，展示单条记录
      const currentTimestamp = ipfsData.updatedAt || ipfsData.timestamp || null;
      if (currentTimestamp && entries.length === 0) {
        entries.push({
          index: 0,
          timestamp: currentTimestamp,
          memberCount: ipfsData.data?.members?.length ?? ipfsData.members?.length ?? null,
          version: ipfsData.version ?? 1,
          summary: ipfsData.familyName || ipfsData.data?.familyName || "当前版本",
          expanded: false,
        });
      }

      // 按时间排序（最新的在前）
      entries.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      // 重新编号
      const sorted = entries.map((e, i) => ({ ...e, index: i }));
      setRevisions(sorted);
    } catch (err) {
      console.error("加载修订历史失败:", err);
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const toggleExpand = useCallback((index: number) => {
    setRevisions((prev) =>
      prev.map((r) => (r.index === index ? { ...r, expanded: !r.expanded } : r))
    );
  }, []);

  // ---------- 渲染 ----------
  if (loading) {
    return (
      <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
        <h2 className="text-xl font-bold text-[#8b0000] mb-6 tracking-wider">
          📜 修订记录
        </h2>
        <div className="flex items-center gap-3 text-[#5c3a2e]/60">
          <div className="w-5 h-5 border-2 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin" />
          <span className="text-sm">加载修订记录...</span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
        <h2 className="text-xl font-bold text-[#8b0000] mb-6 tracking-wider">
          📜 修订记录
        </h2>
        <p className="text-sm text-amber-600">
          ⚠️ {error}
        </p>
        <button
          onClick={loadHistory}
          className="mt-3 px-4 py-2 text-sm bg-[#f5f0e8] text-[#5c3a2e] rounded-xl hover:bg-[#e8dcc8] transition-colors"
        >
          重试
        </button>
      </section>
    );
  }

  if (revisions.length === 0) {
    return (
      <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
        <h2 className="text-xl font-bold text-[#8b0000] mb-6 tracking-wider">
          📜 修订记录
        </h2>
        <p className="text-sm text-[#c4a67a]">暂无修订记录</p>
      </section>
    );
  }

  return (
    <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
      <h2 className="text-xl font-bold text-[#8b0000] mb-6 tracking-wider">
        📜 修订记录
        <span className="ml-2 text-sm font-normal text-[#c4a67a]">
          （共 {revisions.length} 条）
        </span>
      </h2>

      {/* 时间线 */}
      <div className="relative pl-8 space-y-0">
        {/* 竖线 */}
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-[#8b0000] via-[#d4a76a]/50 to-[#d4a76a]/20" />

        {revisions.map((rev, idx) => (
          <div key={rev.index} className="relative pb-6 last:pb-0">
            {/* 圆点 */}
            <div
              className={`absolute -left-[22px] top-1 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center
                ${
                  idx === 0
                    ? "bg-[#8b0000] border-[#8b0000]"
                    : "bg-white border-[#d4a76a]/60"
                }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  idx === 0 ? "bg-white" : "bg-[#d4a76a]/40"
                }`}
              />
            </div>

            {/* 内容卡片 */}
            <div className="ml-4">
              <div
                className="bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/20 p-4 hover:border-[#d4a76a]/40 transition-colors cursor-pointer"
                onClick={() => toggleExpand(rev.index)}
              >
                {/* 头部 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#5c3a2e]">
                        {rev.version ? `v${rev.version}` : `变更 ${rev.index + 1}`}
                      </span>
                      {rev.summary && (
                        <span className="text-xs text-[#8b0000] bg-[#8b0000]/5 px-2 py-0.5 rounded-full">
                          {rev.summary}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#c4a67a] mt-1 flex items-center gap-2">
                      <span>🕒 {formatTimestamp(rev.timestamp)}</span>
                      {rev.memberCount !== null && (
                        <span>👥 {rev.memberCount} 人</span>
                      )}
                    </p>
                  </div>

                  {/* 展开/折叠 */}
                  <div className="flex-shrink-0 text-[#c4a67a] transition-transform duration-200"
                    style={{ transform: rev.expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>

                {/* 展开详情 - 来自 IPFS 元数据 */}
                {rev.expanded && (
                  <div className="mt-3 pt-3 border-t border-[#d4a76a]/20">
                    <p className="text-xs text-[#5c3a2e]">
                      {rev.timestamp
                        ? `更新时间: ${formatTimestamp(rev.timestamp)}`
                        : "时间未知"}
                    </p>
                    {rev.version && (
                      <p className="text-xs text-[#5c3a2e] mt-1">
                        数据版本: v{rev.version}
                      </p>
                    )}
                    {rev.memberCount !== null && (
                      <p className="text-xs text-[#5c3a2e] mt-1">
                        族人数量: {rev.memberCount} 人
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 刷新按钮 */}
      <div className="mt-6 text-center">
        <button
          onClick={loadHistory}
          className="px-4 py-2 text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors"
        >
          🔄 刷新历史
        </button>
      </div>
    </section>
  );
}