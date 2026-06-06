"use client";

import { useState, useMemo } from "react";
import type { Member, FamilyEvent, FamilyTree } from "@/types/family";

// ==================== 类型定义 ====================

interface TimelineEntry {
  id: string;
  year: string;
  title: string;
  description: string;
  type: "birth" | "death" | "manual";
}

// ==================== 生成器 ====================

/** 从成员出生/逝世/安葬年份生成时间线事件 */
function generateLifeEvents(members: Member[]): TimelineEntry[] {
  const events: TimelineEntry[] = [];

  for (const m of members) {
    if (m.birth) {
      events.push({
        id: `birth-${m.id}`,
        year: m.birth,
        title: `${m.name} 出生`,
        description: `${m.name} 于 ${m.birth} 年出生${m.info ? `。${m.info.split("。")[0]}` : ""}`,
        type: "birth",
      });
    }
    if (m.death) {
      events.push({
        id: `death-${m.id}`,
        year: m.death,
        title: `${m.name} 逝世`,
        description: `${m.name} 于 ${m.death} 年逝世${m.info && m.info.split("。").length > 1 ? `。${m.info.split("。").slice(-1)}` : ""}`,
        type: "death",
      });
    }
    // 安葬事件：当逝世日期和安葬地都填了才生成
    if (m.death && m.burialPlace) {
      events.push({
        id: `burial-${m.id}`,
        year: m.death,
        title: `${m.name} 安葬`,
        description: `安葬于 ${m.burialPlace}${m.burialCoords ? `（${m.burialCoords}）` : ""}`,
        type: "death",
      });
    }
  }

  return events;
}

/** 将家族大事转为时间线条目 */
function mapFamilyEvents(familyEvents: FamilyEvent[] | undefined): TimelineEntry[] {
  if (!familyEvents) return [];
  return familyEvents.map((e) => ({
    id: e.id,
    year: e.year,
    title: e.title,
    description: e.description,
    type: "manual" as const,
  }));
}

// ==================== 时间轴组件 ====================

export function FamilyTimeline({
  tree,
  editable,
  onTreeChange,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (newTree: FamilyTree) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // 合并所有事件并排序
  const allEvents = useMemo(() => {
    const life = generateLifeEvents(tree.members);
    const manual = mapFamilyEvents(tree.familyEvents);
    const merged = [...life, ...manual];
    merged.sort((a, b) => {
      const ay = parseInt(a.year) || 9999;
      const by = parseInt(b.year) || 9999;
      if (ay !== by) return ay - by;
      // 同一年：事件类型优先级 birth < manual < death
      const order = { birth: 0, manual: 1, death: 2 };
      return (order[a.type] ?? 1) - (order[b.type] ?? 1);
    });
    return merged;
  }, [tree.members, tree.familyEvents]);

  // 按世纪分组
  const grouped = useMemo(() => {
    const groups: { century: string; events: TimelineEntry[] }[] = [];
    const map = new Map<string, TimelineEntry[]>();
    for (const evt of allEvents) {
      const year = parseInt(evt.year) || 0;
      const key = year < 0 ? "bc" : `c${Math.floor(year / 100)}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(evt);
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      if (a === "bc") return -1;
      if (b === "bc") return 1;
      return parseInt(a.slice(1)) - parseInt(b.slice(1));
    });
    for (const key of sortedKeys) {
      const events = map.get(key)!;
      const firstYear = parseInt(events[0].year) || 0;
      const centuryLabel = key === "bc"
        ? "公元前"
        : `${Math.floor(firstYear / 100) * 100 + 1}—${Math.ceil(firstYear / 100) * 100}年`;
      groups.push({ century: centuryLabel, events });
    }
    return groups;
  }, [allEvents]);

  const handleAddEvent = () => {
    if (!newYear.trim() || !newTitle.trim()) return;
    const newEvent: FamilyEvent = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      year: newYear.trim(),
      title: newTitle.trim(),
      description: newDesc.trim() || newTitle.trim(),
    };
    const updated: FamilyTree = {
      ...tree,
      familyEvents: [...(tree.familyEvents || []), newEvent],
      updatedAt: new Date().toISOString(),
    };
    onTreeChange?.(updated);
    setNewYear("");
    setNewTitle("");
    setNewDesc("");
    setShowForm(false);
  };

  const handleDeleteEvent = (eventId: string) => {
    const updated: FamilyTree = {
      ...tree,
      familyEvents: (tree.familyEvents || []).filter((e) => e.id !== eventId),
      updatedAt: new Date().toISOString(),
    };
    onTreeChange?.(updated);
  };

  const eventCount = allEvents.length;
  const manualCount = (tree.familyEvents || []).length;

  return (
    <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8">
      {/* 标题 */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">📅</span>
          <h2 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider">
            家族时间轴
          </h2>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mt-2 mb-2" />
        <p className="text-[#5c3a2e] text-sm">
          共 {eventCount} 个事件 · 其中 {manualCount} 个手动记录
        </p>
      </div>

      {/* 时间轴内容 */}
      {allEvents.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🕰️</div>
          <p className="text-[#5c3a2e] text-sm">
            暂无事件数据。添加成员出生/逝世年份后将自动生成时间轴事件
          </p>
          {editable && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-5 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors shadow-lg shadow-[#8b0000]/20"
            >
              ✏️ 添加家族大事
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* 纵向时间线（左侧竖线） */}
          <div className="absolute left-[18px] top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#8b0000]/30 via-[#8b4513]/40 to-[#8b0000]/30 rounded-full" />

          {/* 按世纪分组 */}
          <div className="space-y-8">
            {grouped.map((group) => (
              <div key={group.century}>
                {/* 世纪分隔标签 */}
                <div className="flex items-center gap-3 mb-4 pl-10">
                  <div className="w-3 h-3 rounded-full bg-[#8b0000] ring-4 ring-[#f5f0e8] flex-shrink-0" />
                  <span className="text-sm font-bold text-[#8b0000] tracking-wide">
                    {group.century}
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-[#d4a76a]/40 to-transparent" />
                </div>

                {/* 该世纪内的事件列表 */}
                <div className="space-y-4">
                  {group.events.map((evt) => (
                    <div key={evt.id} className="group relative flex items-start gap-4 pl-10">
                      {/* 节点圆点 */}
                      <div className="absolute left-[14px] top-[6px] w-[11px] h-[11px] rounded-full border-2 flex-shrink-0 z-10"
                        style={{
                          backgroundColor:
                            evt.type === "birth"
                              ? "#d4a76a"
                              : evt.type === "death"
                                ? "#5c3a2e"
                                : "#8b0000",
                          borderColor:
                            evt.type === "birth"
                              ? "#c49a5e"
                              : evt.type === "death"
                                ? "#3a2216"
                                : "#6b0000",
                        }}
                      />

                      {/* 事件卡片 */}
                      <div className="flex-1 bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/15 p-4 hover:border-[#d4a76a]/40 hover:shadow-md transition-all duration-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            {/* 年份标签 */}
                            <span className="inline-block text-[10px] font-bold text-white px-2 py-0.5 rounded-full mb-1"
                              style={{
                                backgroundColor:
                                  evt.type === "birth"
                                    ? "#d4a76a"
                                    : evt.type === "death"
                                      ? "#5c3a2e"
                                      : "#8b0000",
                              }}
                            >
                              {evt.type === "birth" ? "出生" : evt.type === "death" ? "逝世" : "大事"}
                            </span>
                            <span className="ml-2 text-xs font-mono text-[#c4a67a]">
                              {evt.year} 年
                            </span>
                          </div>
                          {/* 删除按钮（仅手动事件可删） */}
                          {editable && evt.type === "manual" && (
                            <button
                              onClick={() => handleDeleteEvent(evt.id)}
                              className="opacity-0 group-hover:opacity-100 text-[#c4a67a] hover:text-red-500 transition-all text-sm"
                              title="删除此事件"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        <h4 className="font-bold text-[#5c3a2e] text-sm mt-1">
                          {evt.title}
                        </h4>
                        {evt.description && evt.description !== evt.title && (
                          <p className="text-xs text-[#5c3a2e]/70 mt-1 whitespace-pre-wrap leading-relaxed">
                            {evt.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 底部收束圆点 */}
          <div className="flex items-center gap-3 mt-8 pl-10">
            <div className="w-3 h-3 rounded-full bg-[#d4a76a]/40 flex-shrink-0" />
            <span className="text-xs text-[#c4a67a]">时间线终点</span>
          </div>
        </div>
      )}

      {/* 添加家族大事按钮（编辑模式下始终显示）- 醒目样式 */}
      {editable && (
        <div className="text-center mt-6">
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white rounded-xl font-bold text-base hover:from-[#a52a2a] hover:to-[#8b0000] transition-all shadow-lg shadow-[#8b0000]/30 hover:shadow-xl hover:shadow-[#8b0000]/40 hover:scale-105 active:scale-95"
          >
            ➕ 记录家族大事
          </button>
        </div>
      )}

      {/* 添加表单弹窗 */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[#8b0000] mb-4 tracking-wider">
              ✏️ 添加家族大事
            </h3>
            <p className="text-xs text-[#c4a67a] mb-4">
              记录家族迁徙、重要事件、历史时刻等
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">年份 *</label>
                <input
                  type="text"
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                  placeholder="如：1962"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">标题 *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                  placeholder="如：从山东迁至黑龙江"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">描述（可选）</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none"
                  placeholder="详细描述这一事件……"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleAddEvent}
                disabled={!newYear.trim() || !newTitle.trim()}
                className="flex-1 px-4 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40"
              >
                添加
              </button>
              <button
                onClick={() => { setShowForm(false); setNewYear(""); setNewTitle(""); setNewDesc(""); }}
                className="px-4 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}