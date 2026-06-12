"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { getImageUrls, createImgFallback } from "@/lib/ipfsGateway";
import type { Member, FamilyTree } from "@/types/family";
import MemberMemories from "./MemberMemories";

// ==================== 类型定义 ====================

/** 内部树节点，补全计算属性 */
interface TreeNode {
  member: Member;
  generation: number;
  children: TreeNode[];
  spouse: TreeNode | null;
}

/** 夫妻组（按配偶关系配对） */
interface CoupleGroup {
  husband: TreeNode | null;
  wife: TreeNode | null;
  children: TreeNode[];
}

/** 一代人 */
interface GenerationRow {
  generation: number;
  couples: CoupleGroup[];
}

// ==================== 工具函数 ====================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 出生年份排序 */
function sortByBirth(a: Member, b: Member) {
  const ay = a.birth ? parseInt(a.birth) : 9999;
  const by = b.birth ? parseInt(b.birth) : 9999;
  return ay - by;
}

const MAX_GENERATION = 30;

/**
 * 获取某成员的所有子女 ID（兼容 parentId / fatherId / motherId / childrenIds）
 */
function getChildIds(member: Member, members: Member[]): string[] {
  const ids = new Set<string>();

  // 通过 childrenIds 字段
  if (member.childrenIds) {
    for (const cid of member.childrenIds) ids.add(cid);
  }

  // 通过 parentId / fatherId / motherId 反向查找
  for (const m of members) {
    if (m.parentId === member.id ||
        m.fatherId === member.id ||
        m.motherId === member.id) {
      ids.add(m.id);
    }
  }

  return Array.from(ids);
}

// ==================== 核心树构建（含递归防护） ====================

function buildPagodaTree(members: Member[]): GenerationRow[] {
  if (members.length === 0) return [];

  // 1. 建节点索引
  const nodeMap = new Map<string, TreeNode>();
  for (const m of members) {
    nodeMap.set(m.id, {
      member: m,
      generation: 0,
      children: [],
      spouse: null,
    });
  }

  // 2. 配偶关联（双向 spouseOf / spouseId）
  for (const m of members) {
    // 通过 spouseOf
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id)!;
      const spouseNode = nodeMap.get(m.spouseOf)!;
      node.spouse = spouseNode;
      spouseNode.spouse = node;
    }
    // 通过 spouseId
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id)!;
      const spouseNode = nodeMap.get(m.spouseId)!;
      node.spouse = spouseNode;
      spouseNode.spouse = node;
    }
  }

  // 3. 寻找根节点（没有任何父辈关系的节点）
  const rootIds: string[] = [];
  for (const m of members) {
    const hasParent =
      (m.parentId && nodeMap.has(m.parentId)) ||
      (m.fatherId && nodeMap.has(m.fatherId)) ||
      (m.motherId && nodeMap.has(m.motherId));
    // 也检查是否别人把自己当子女
    let isChildOfSomeone = false;
    for (const other of members) {
      if (other.id === m.id) continue;
      if (other.childrenIds?.includes(m.id)) {
        isChildOfSomeone = true;
        break;
      }
      if (other.parentId === m.id || other.fatherId === m.id || other.motherId === m.id) {
        isChildOfSomeone = true;
        break;
      }
    }
    if (!hasParent && !isChildOfSomeone) {
      rootIds.push(m.id);
    }
  }

  // 4. BFS 层级遍历（从根节点开始）
  const visited = new Set<string>();
  const queue: { nodeId: string; gen: number }[] = [];

  for (const rootId of rootIds) {
    if (!visited.has(rootId)) {
      queue.push({ nodeId: rootId, gen: 0 });
    }
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift()!;

    if (visited.has(nodeId)) continue;
    if (gen > MAX_GENERATION) continue;

    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    node.generation = gen;

    // 找子女（兼容各种关联字段）
    const childIds = getChildIds(node.member, members);
    for (const cid of childIds) {
      const childNode = nodeMap.get(cid);
      if (childNode && !visited.has(cid)) {
        node.children.push(childNode);
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

  // 5. 子女按出生年份排序
  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  // 6. 按代际分组为 CoupleGroup[]
  const genMap = new Map<number, TreeNode[]>();
  for (const [, node] of nodeMap) {
    const gen = node.generation;
    if (!genMap.has(gen)) {
      genMap.set(gen, []);
    }
    genMap.get(gen)!.push(node);
  }

  const generations: GenerationRow[] = [];
  const sortedGens = Array.from(genMap.keys()).sort((a, b) => a - b);

  for (const gen of sortedGens) {
    const nodes = genMap.get(gen)!;
    const couples = buildCoupleGroups(nodes);
    generations.push({ generation: gen, couples });
  }

  return generations;
}

/** 将同一代的节点按配偶关系配对为夫妻组 */
function buildCoupleGroups(nodes: TreeNode[]): CoupleGroup[] {
  const groups: CoupleGroup[] = [];
  const used = new Set<string>();

  for (const node of nodes) {
    if (used.has(node.member.id)) continue;

    if (node.spouse && !used.has(node.spouse.member.id)) {
      // 有配偶，配对 — 父亲在左、母亲在右
      const spouseNode = node.spouse;

      // 判断谁是丈夫/父亲（按 gender 字段，或按 ID 排序）
      const isHusband =
        node.member.gender === "男" ||
        (spouseNode.member.gender === "女" && node.member.gender !== "女") ||
        node.member.id < spouseNode.member.id;

      const husband = isHusband ? node : spouseNode;
      const wife = isHusband ? spouseNode : node;

      groups.push({
        husband,
        wife,
        children: husband.children,
      });
      used.add(node.member.id);
      used.add(spouseNode.member.id);
    } else {
      // 无配偶
      groups.push({
        husband: node,
        wife: null,
        children: node.children,
      });
      used.add(node.member.id);
    }
  }

  return groups;
}

// ==================== 代际标签 ====================

function getGenerationLabel(gen: number): string {
  const labels = ["始祖", "二世", "三世", "四世", "五世", "六世", "七世", "八世", "九世", "十世"];
  if (gen < labels.length) return labels[gen];
  return `${gen + 1}世`;
}

// ==================== 连线组件（深棕色 2px 实线） ====================

const LINE_COLOR = "#4a2c17"; // 深棕色
const LINE_WIDTH = 2;

function VerticalLine({ height = 28, color = LINE_COLOR }: { height?: number; color?: string }) {
  return (
    <div className="flex justify-center" style={{ height }}>
      <div style={{ backgroundColor: color, height: "100%", width: LINE_WIDTH }} />
    </div>
  );
}

function HorizontalLine({ width = 16, color = LINE_COLOR }: { width?: number; color?: string }) {
  return (
    <div className="flex items-center" style={{ width }}>
      <div style={{ backgroundColor: color, flex: 1, height: LINE_WIDTH }} />
    </div>
  );
}

/** 分叉实心圆点 */
function ConnectorDot({ size = 8, color = LINE_COLOR }: { size?: number; color?: string }) {
  return (
    <div
      className="rounded-full"
      style={{ width: size, height: size, minWidth: size, backgroundColor: color }}
    />
  );
}

/** 浅色兄弟姊妹连线 */
function SiblingLine({ length = 40 }: { length?: number }) {
  return (
    <div className="flex items-center" style={{ width: length }}>
      <div style={{ backgroundColor: "#c4b5a0", flex: 1, height: 1 }} />
    </div>
  );
}

// ==================== 编辑表单组件 ====================

interface EditFormData {
  name: string;
  birth: string;
  death: string;
  info: string;
  story: string;
  burialPlace: string;
  burialCoords: string;
}

function MemberEditForm({
  initial,
  onSave,
  onCancel,
  title,
  storyFocus,
}: {
  initial: EditFormData;
  onSave: (data: EditFormData) => void;
  onCancel: () => void;
  title: string;
  storyFocus?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [birth, setBirth] = useState(initial.birth);
  const [death, setDeath] = useState(initial.death);
  const [info, setInfo] = useState(initial.info);
  const [story, setStory] = useState(initial.story);
  const [burialPlace, setBurialPlace] = useState(initial.burialPlace);
  const [burialCoords, setBurialCoords] = useState(initial.burialCoords);
  const storyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (storyFocus && storyRef.current) {
      setTimeout(() => {
        storyRef.current?.focus();
        storyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, [storyFocus]);

  const hasDeath = death.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-[#8b0000] mb-4 tracking-wider">
          {title}
        </h3>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">姓名 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
              placeholder="输入姓名"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">出生年份</label>
            <input
              type="text"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
              placeholder="如：1950"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">逝世年份</label>
            <input
              type="text"
              value={death}
              onChange={(e) => setDeath(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
              placeholder="如：2020"
            />
          </div>

          {/* 安葬地 - 仅在填写了逝世日期后显示 */}
          {hasDeath && (
            <>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">🪦 安葬地</label>
                <input
                  type="text"
                  value={burialPlace}
                  onChange={(e) => setBurialPlace(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                  placeholder="如：河北保定某陵园"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">安葬地坐标（可选）</label>
                <input
                  type="text"
                  value={burialCoords}
                  onChange={(e) => setBurialCoords(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                  placeholder="纬度,经度（如：39.9042,116.4074）"
                />
                <p className="text-[10px] text-[#c4a67a] mt-0.5">填写坐标后，在详情页可点击跳转地图查看</p>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">生平简介</label>
            <textarea
              value={info}
              onChange={(e) => setInfo(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none"
              placeholder="输入生平简介"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">📖 我的故事（可选）</label>
            <textarea
              ref={storyRef}
              value={story}
              onChange={(e) => setStory(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none"
              placeholder="讲述您的家族故事、人生经历、难忘回忆……"
            />
            <p className="text-[10px] text-[#c4a67a] mt-0.5">故事将展示在成员卡片中，点击可展开全文</p>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={() => {
              if (!name.trim()) return;
              onSave({
                name: name.trim(),
                birth,
                death,
                info,
                story: story.trim() || "",
                burialPlace: burialPlace.trim() || "",
                burialCoords: burialCoords.trim() || "",
              });
            }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40"
          >
            保存
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 成员卡片（古典中国风） ====================

function MemberCard({
  member,
  isSpouse = false,
  editable = false,
  onEdit,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  member: Member;
  isSpouse?: boolean;
  editable?: boolean;
  onEdit?: () => void;
  onEditStory?: () => void;
  onAddParent?: () => void;
  onAddChild?: () => void;
  onAddSpouse?: () => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const birthText =
    member.birth && member.death
      ? `${member.birth}—${member.death}`
      : member.birth
        ? `生于 ${member.birth}`
        : member.death
          ? `卒于 ${member.death}`
          : null;

  return (
    <div className="relative flex flex-col items-center">
      {/* 操作菜单按钮 */}
      {editable && (
        <div className="relative mb-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="w-5 h-5 rounded-full bg-[#8b0000] text-white text-[10px] font-bold shadow-md hover:bg-[#a52a2a] transition-colors flex items-center justify-center"
            title="操作"
          >
            +
          </button>
          {menuOpen && (
            <div
              className="absolute top-6 left-1/2 -translate-x-1/2 z-20 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-1.5 flex gap-1 whitespace-nowrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => { onEdit?.(); setMenuOpen(false); }}
                className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors"
              >✏️ 编辑</button>
              <button
                onClick={() => { onAddParent?.(); setMenuOpen(false); }}
                className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors"
              >⬆️ 父辈</button>
              <button
                onClick={() => { onAddChild?.(); setMenuOpen(false); }}
                className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors"
              >⬇️ 子嗣</button>
              <button
                onClick={() => { onAddSpouse?.(); setMenuOpen(false); }}
                className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors"
              >👩‍❤️‍👨 配偶</button>
            </div>
          )}
        </div>
      )}

      {/* 写故事/看故事小图标 - 始终显示 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (editable) {
            onEditStory?.();
          } else {
            onRequestEdit?.();
            onEdit?.();
          }
        }}
        className="text-xs mb-0.5 hover:scale-110 transition-transform"
        title={member.story ? "查看故事" : "写故事"}
      >
        {member.story ? "📖" : "✏️ 写故事"}
      </button>

      {/* 卡片 */}
      <div
        className={`
          px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-200
          border-2 select-none min-w-[80px] text-center relative
          ${editable ? "ring-2 ring-[#8b0000]/20" : ""}
          ${
            isSpouse
              ? "bg-rose-50/80 border-rose-300/50 hover:border-rose-400 hover:shadow-rose-100"
              : "bg-white border-[#d4a76a] hover:border-[#8b0000] hover:shadow-lg"
          }
          hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]
        `}
        onClick={() => setShowDetail(!showDetail)}
      >
        <div
          className={`font-bold tracking-wider ${
            isSpouse ? "text-rose-700 text-sm" : "text-[#8b0000] text-base"
          }`}
        >
          {member.name}
        </div>
        {birthText && (
          <div className="text-[10px] text-[#5c3a2e]/50 mt-0.5 leading-tight">
            {birthText}
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      {showDetail && (
        <div
          className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 text-sm text-[#5c3a2e] leading-relaxed"
          onClick={(e) => e.stopPropagation()}
          style={{ minWidth: "200px" }}
        >
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-[#d4a76a]/20 rotate-45" />
          
          <p className="font-bold text-[#8b0000] mb-1 text-base">{member.name}</p>
          
          {birthText && (
            <p className="text-xs text-[#5c3a2e]/60 mb-2">{birthText}</p>
          )}

          {member.burialPlace && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">🪦 安葬地</p>
              {member.burialCoords ? (
                <a
                  href={`https://www.google.com/maps?q=${member.burialCoords}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#8b0000] underline hover:text-[#a52a2a]"
                >
                  {member.burialPlace} 📍
                </a>
              ) : (
                <p className="text-xs text-[#5c3a2e]/80">{member.burialPlace}</p>
              )}
            </div>
          )}

          {/* 照片展示 */}
          <div className="mb-3">
            {member.photoOriginal || member.photoRestored ? (
              <>
                <div className="relative w-full h-36 rounded-lg overflow-hidden bg-[#f5f0e8] border border-[#d4a76a]/20">
                  <img
                    src={(() => {
                      const cid = member.photoRestored || member.photoOriginal || "";
                      return getImageUrls(cid)[0];
                    })()}
                    onError={(() => {
                      const cid = member.photoRestored || member.photoOriginal || "";
                      return createImgFallback(getImageUrls(cid));
                    })()}
                    alt={member.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                {member.photoOriginal && member.photoRestored && member.photoRestored !== member.photoOriginal && (
                  <p className="text-[10px] text-green-600 mt-1 text-center">✨ AI 修复版</p>
                )}
              </>
            ) : editable ? (
              <div
                className="w-full h-24 rounded-lg border-2 border-dashed border-[#d4a76a]/40 bg-[#fdfbf7] flex flex-col items-center justify-center cursor-pointer hover:border-[#8b0000]/50 hover:bg-[#f5f0e8] transition-all"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append('photo', file);
                    formData.append('memberId', member.id);
                    try {
                      const res = await fetch('/api/upload-photo', { method: 'POST', body: formData });
                      const data = await res.json();
                      if (data.cid) {
                        alert('照片上传成功！请保存修订以永久保存。');
                      } else {
                        alert(data.error || '上传失败');
                      }
                    } catch {
                      alert('网络异常，请稍后重试');
                    }
                  };
                  input.click();
                }}
              >
                <span className="text-2xl mb-1">📷</span>
                <span className="text-xs text-[#c4a67a] font-bold">添加照片，让记忆更完整</span>
              </div>
            ) : (
              <div className="w-full h-24 rounded-lg bg-[#fdfbf7] border border-[#d4a76a]/10 flex items-center justify-center">
                <span className="text-xs text-[#c4a67a]/60">暂无照片</span>
              </div>
            )}
          </div>

          {member.info && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">📜 生平</p>
              <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">
                {member.info}
              </p>
            </div>
          )}

          {member.story && (
            <StoryBlock story={member.story} />
          )}

          <MemberMemories
            member={member}
            editable={editable}
            onUpdateMember={onUpdateMember}
          />

          <button
            className="w-full mt-1 text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors py-1"
            onClick={() => setShowDetail(false)}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== 夫妻组（父亲在左、母亲在右，带共享边框） ====================

function CoupleUnit({
  couple,
  editable,
  onEditMember,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  couple: CoupleGroup;
  editable: boolean;
  onEditMember: (m: Member) => void;
  onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void;
  onAddChild: (m: Member) => void;
  onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  const husband = couple.husband;
  const wife = couple.wife;
  const children = couple.children;

  // 渲染夫妻卡片
  const coupleContent = (
    <div className="flex items-center gap-1">
      {/* 父亲卡片 */}
      {husband && (
        <MemberCard
          member={husband.member}
          editable={editable}
          onEdit={() => onEditMember(husband.member)}
          onEditStory={() => onEditStory(husband.member)}
          onAddParent={() => onAddParent(husband.member)}
          onAddChild={() => onAddChild(husband.member)}
          onAddSpouse={() => onAddSpouse(husband.member)}
          onRequestEdit={onRequestEdit}
          onUpdateMember={onUpdateMember}
        />
      )}
      {/* 夫妻连线：中间用横线 + "配" 字 */}
      {husband && wife && (
        <div className="flex items-center">
          <ConnectorDot size={5} />
          <HorizontalLine width={10} />
          <span className="text-[#4a2c17] text-xs font-bold mx-0.5 tracking-widest">配</span>
          <HorizontalLine width={10} />
          <ConnectorDot size={5} />
        </div>
      )}
      {/* 母亲卡片 */}
      {wife && (
        <MemberCard
          member={wife.member}
          isSpouse
          editable={editable}
          onEdit={() => onEditMember(wife.member)}
          onEditStory={() => onEditStory(wife.member)}
          onAddParent={() => onAddParent(wife.member)}
          onAddChild={() => onAddChild(wife.member)}
          onAddSpouse={() => onAddSpouse(wife.member)}
          onRequestEdit={onRequestEdit}
          onUpdateMember={onUpdateMember}
        />
      )}
      {/* 仅单身 */}
      {husband && !wife && (
        <div className="w-4" />
      )}
    </div>
  );

  // 有配偶时用浅色共享边框包裹
  const coupleWrapper = husband && wife ? (
    <div className="border border-[#d4a76a]/30 rounded-xl px-3 py-2 inline-flex items-center">
      {coupleContent}
    </div>
  ) : coupleContent;

  return (
    <div className="flex flex-col items-center">
      {/* 夫妻行 */}
      {coupleWrapper}

      {/* 向下连线 — 从夫妻中间正下方引出 */}
      {children.length > 0 && (
        <>
          {/* 有配偶时从夫妻中间引出，无配偶时从单人正下方引出 */}
          <div className="flex justify-center items-center pt-1">
            <ConnectorDot size={6} />
          </div>
          <VerticalLine height={24} />
          
          {/* 子女簇 */}
          <ChildrenCluster
            children={children}
            editable={editable}
            onEditMember={onEditMember}
            onEditStory={onEditStory}
            onAddParent={onAddParent}
            onAddChild={onAddChild}
            onAddSpouse={onAddSpouse}
            onRequestEdit={onRequestEdit}
            onUpdateMember={onUpdateMember}
          />
        </>
      )}
    </div>
  );
}

// ==================== 子女组合（兄妹间浅色横线，按出生年份排列） ====================

function ChildrenCluster({
  children,
  editable,
  onEditMember,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  children: TreeNode[];
  editable: boolean;
  onEditMember: (m: Member) => void;
  onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void;
  onAddChild: (m: Member) => void;
  onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  if (children.length === 0) return null;

  return (
    <div className="flex items-start justify-center gap-2 relative">
      {children.map((child, idx) => (
        <div key={child.member.id} className="flex flex-col items-center relative">
          <VerticalLine height={24} />
          <ConnectorDot size={5} />
          <div className="flex items-center gap-0.5">
            <MemberCard
              member={child.member}
              editable={editable}
              onEdit={() => onEditMember(child.member)}
              onEditStory={() => onEditStory(child.member)}
              onAddParent={() => onAddParent(child.member)}
              onAddChild={() => onAddChild(child.member)}
              onAddSpouse={() => onAddSpouse(child.member)}
              onRequestEdit={onRequestEdit}
              onUpdateMember={onUpdateMember}
            />
            {child.spouse && (
              <>
                <div className="flex items-center">
                  <ConnectorDot size={4} />
                  <HorizontalLine width={6} />
                  <span className="text-[#4a2c17] text-[10px] font-bold mx-0.5">配</span>
                  <HorizontalLine width={6} />
                  <ConnectorDot size={4} />
                </div>
                <MemberCard
                  member={child.spouse!.member}
                  isSpouse
                  editable={editable}
                  onEdit={() => child.spouse && onEditMember(child.spouse.member)}
                  onEditStory={() => child.spouse && onEditStory(child.spouse.member)}
                  onAddParent={() => child.spouse && onAddParent(child.spouse.member)}
                  onAddChild={() => child.spouse && onAddChild(child.spouse.member)}
                  onAddSpouse={() => child.spouse && onAddSpouse(child.spouse.member)}
                  onRequestEdit={onRequestEdit}
                  onUpdateMember={onUpdateMember}
                />
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StoryBlock({ story }: { story: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!story) return null;
  const isLong = story.length > 100;
  return (
    <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
      <button className="w-full text-left" onClick={() => setExpanded(!expanded)}>
        <p className="text-xs font-bold text-[#8b0000]/70 mb-1">
          📖 我的故事 {isLong && (expanded ? "▲" : "▼")}
        </p>
        <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">
          {isLong && !expanded ? story.slice(0, 100) + "…" : story}
        </p>
      </button>
    </div>
  );
}

function GenerationRowView({
  row,
  editable,
  onEditMember,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  row: GenerationRow;
  editable: boolean;
  onEditMember: (m: Member) => void;
  onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void;
  onAddChild: (m: Member) => void;
  onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  return (
    <div className="flex flex-col items-center w-full py-4">
      <div className="mb-3 px-4 py-1 rounded-full bg-[#8b0000]/5 border border-[#d4a76a]/20 text-xs font-bold text-[#8b0000] tracking-wider">
        {getGenerationLabel(row.generation)}
      </div>
      <div className="flex items-start justify-center gap-6 md:gap-10 lg:gap-14 flex-wrap">
        {row.couples.map((couple, idx) => (
          <CoupleUnit
            key={`${couple.husband?.member.id ?? "n"}-${couple.wife?.member.id ?? "n"}-${idx}`}
            couple={couple}
            editable={editable}
            onEditMember={onEditMember}
            onEditStory={onEditStory}
            onAddParent={onAddParent}
            onAddChild={onAddChild}
            onAddSpouse={onAddSpouse}
            onRequestEdit={onRequestEdit}
            onUpdateMember={onUpdateMember}
          />
        ))}
      </div>
    </div>
  );
}

function InterGenerationLine() {
  return (
    <div className="flex justify-center py-1">
      <VerticalLine height={36} />
    </div>
  );
}

function PagodaView({
  generations,
  editable,
  onEditMember,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  generations: GenerationRow[];
  editable: boolean;
  onEditMember: (m: Member) => void;
  onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void;
  onAddChild: (m: Member) => void;
  onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  if (generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[#c4a67a]">
        <div className="text-5xl mb-4">🌳</div>
        <p className="text-lg font-bold tracking-wider">暂无家族成员</p>
        <p className="text-sm mt-2">点击卡片上的 + 添加第一位家族成员</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center w-full max-w-full overflow-x-auto py-6 px-4">
      <div className="flex flex-col items-center min-w-max">
        {generations.map((row, idx) => (
          <div key={row.generation} className="flex flex-col items-center">
            <GenerationRowView
              row={row}
              editable={editable}
              onEditMember={onEditMember}
              onEditStory={onEditStory}
              onAddParent={onAddParent}
              onAddChild={onAddChild}
              onAddSpouse={onAddSpouse}
              onRequestEdit={onRequestEdit}
              onUpdateMember={onUpdateMember}
            />
            {idx < generations.length - 1 && <InterGenerationLine />}
          </div>
        ))}
      </div>
    </div>
  );
}

interface TempMember {
  name: string;
  birth: string;
  death: string;
  info: string;
  story: string;
  burialPlace: string;
  burialCoords: string;
}

/** 旧接口兼容导出（供 family/[familyId]/page.tsx 使用） */
export function PagodaTreeView({
  tree,
  editable,
  onTreeChange,
  onRequestEdit,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (updated: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  return (
    <FamilyTreePagoda
      tree={tree}
      editable={editable}
      onUpdateTree={onTreeChange}
      onRequestEdit={onRequestEdit}
    />
  );
}

export default function FamilyTreePagoda({
  tree,
  editable = false,
  onUpdateTree,
  onRequestEdit,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onUpdateTree?: (updated: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingStoryMember, setEditingStoryMember] = useState<Member | null>(null);
  const [addingRelation, setAddingRelation] = useState<{ type: "parent" | "child" | "spouse"; target: Member } | null>(null);
  const [requestEditModal, setRequestEditModal] = useState(false);

  const generations = useMemo(() => buildPagodaTree(tree.members), [tree.members]);

  const handleUpdateMember = useCallback((updated: Member) => {
    if (!onUpdateTree) return;
    const newMembers = tree.members.map((m) => (m.id === updated.id ? updated : m));
    onUpdateTree({ ...tree, members: newMembers });
  }, [tree, onUpdateTree]);

  const handleSaveEdit = useCallback((data: EditFormData) => {
    if (!editingMember || !onUpdateTree) return;
    const updated = { ...editingMember, name: data.name, birth: data.birth, death: data.death, info: data.info, story: data.story, burialPlace: data.burialPlace, burialCoords: data.burialCoords, updatedAt: new Date().toISOString() };
    handleUpdateMember(updated);
    setEditingMember(null);
  }, [editingMember, onUpdateTree, handleUpdateMember]);

  const handleSaveStory = useCallback((data: EditFormData) => {
    if (!editingStoryMember || !onUpdateTree) return;
    const updated = { ...editingStoryMember, name: data.name, story: data.story, updatedAt: new Date().toISOString() };
    handleUpdateMember(updated);
    setEditingStoryMember(null);
  }, [editingStoryMember, onUpdateTree, handleUpdateMember]);

  const handleSaveRelation = useCallback((data: TempMember) => {
    if (!addingRelation || !onUpdateTree) return;
    const newMember: Member = { id: generateId(), name: data.name || "未知", birth: data.birth, death: data.death, info: data.info, story: data.story, burialPlace: data.burialPlace, burialCoords: data.burialCoords, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const { type, target } = addingRelation;
    if (type === "parent") {
      newMember.childrenIds = [target.id];
    } else if (type === "child") {
      if (target.gender === "男") newMember.fatherId = target.id;
      else if (target.gender === "女") newMember.motherId = target.id;
      else newMember.parentId = target.id;
      const tu = tree.members.find((m) => m.id === target.id);
      if (tu) handleUpdateMember({ ...tu, childrenIds: [...(tu.childrenIds || []), newMember.id] });
    } else if (type === "spouse") {
      newMember.spouseOf = target.id;
      newMember.spouseId = target.id;
      newMember.gender = target.gender === "男" ? "女" : "男";
      const tu = tree.members.find((m) => m.id === target.id);
      if (tu) handleUpdateMember({ ...tu, spouseId: newMember.id });
    }
    onUpdateTree({ ...tree, members: [...tree.members, newMember] });
    setAddingRelation(null);
  }, [addingRelation, tree, onUpdateTree, handleUpdateMember]);

  return (
    <div className="relative">
      <PagodaView
        generations={generations}
        editable={editable}
        onEditMember={(m) => setEditingMember(m)}
        onEditStory={(m) => setEditingStoryMember(m)}
        onAddParent={(m) => setAddingRelation({ type: "parent", target: m })}
        onAddChild={(m) => setAddingRelation({ type: "child", target: m })}
        onAddSpouse={(m) => setAddingRelation({ type: "spouse", target: m })}
        onRequestEdit={() => setRequestEditModal(true)}
        onUpdateMember={handleUpdateMember}
      />
      {editingMember && (
        <MemberEditForm
          initial={{ name: editingMember.name, birth: editingMember.birth || "", death: editingMember.death || "", info: editingMember.info || "", story: editingMember.story || "", burialPlace: editingMember.burialPlace || "", burialCoords: editingMember.burialCoords || "" }}
          onSave={handleSaveEdit}
          onCancel={() => setEditingMember(null)}
          title={`编辑 - ${editingMember.name}`}
        />
      )}
      {editingStoryMember && (
        <MemberEditForm
          initial={{ name: editingStoryMember.name, birth: editingStoryMember.birth || "", death: editingStoryMember.death || "", info: editingStoryMember.info || "", story: editingStoryMember.story || "", burialPlace: editingStoryMember.burialPlace || "", burialCoords: editingStoryMember.burialCoords || "" }}
          onSave={handleSaveStory}
          onCancel={() => setEditingStoryMember(null)}
          title={`📖 编辑故事 - ${editingStoryMember.name}`}
          storyFocus
        />
      )}
      {addingRelation && (
        <MemberEditForm
          initial={{ name: "", birth: "", death: "", info: "", story: "", burialPlace: "", burialCoords: "" }}
          onSave={(data) => { if (addingRelation.type === "spouse" && !data.name) data.name = "未知"; handleSaveRelation(data); }}
          onCancel={() => setAddingRelation(null)}
          title={addingRelation.type === "parent" ? "⬆️ 添加父辈" : addingRelation.type === "child" ? "⬇️ 添加子嗣" : "👩‍❤️‍👨 添加配偶"}
        />
      )}
      {requestEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRequestEditModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-sm mx-4 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">🔒</div>
            <h3 className="text-lg font-bold text-[#8b0000] mb-2">需要编辑权限</h3>
            <p className="text-sm text-[#5c3a2e] mb-6">您需要被邀请为编辑者才能修改此家族的成员信息。<br />请联系家族创建者邀请您。</p>
            <button onClick={() => setRequestEditModal(false)} className="px-6 py-2 rounded-xl bg-[#8b0000] text-white font-bold text-sm hover:bg-[#a52a2a] transition-colors">我知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
