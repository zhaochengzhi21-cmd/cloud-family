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

  // 2. 配偶关联（双向 spouseOf）
  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id)!;
      const spouseNode = nodeMap.get(m.spouseOf)!;
      node.spouse = spouseNode;
      spouseNode.spouse = node;
    }
  }

  // 3. 寻找根节点（parentId 为空 或 指向不存在的节点）
  const rootIds: string[] = [];
  for (const m of members) {
    if (!m.parentId || !nodeMap.has(m.parentId)) {
      rootIds.push(m.id);
    }
  }

  // 4. BFS 层级遍历（递归防护：visited Set + 最大深度）
  const visited = new Set<string>();
  const queue: { nodeId: string; gen: number }[] = [];

  for (const rootId of rootIds) {
    if (!visited.has(rootId)) {
      queue.push({ nodeId: rootId, gen: 0 });
    }
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift()!;

    // 递归防护：已访问跳过
    if (visited.has(nodeId)) continue;
    // 深度限制
    if (gen > MAX_GENERATION) continue;

    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    node.generation = gen;

    // 找子女
    for (const m of members) {
      if (m.parentId === nodeId && nodeMap.has(m.id) && !visited.has(m.id)) {
        const child = nodeMap.get(m.id)!;
        node.children.push(child);
        queue.push({ nodeId: m.id, gen: gen + 1 });
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
      // 有配偶，配对
      const spouseNode = node.spouse;
      const isLeft = node.member.id < spouseNode.member.id;
      const husband = isLeft ? node : spouseNode;
      const wife = isLeft ? spouseNode : node;

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

// ==================== 连线组件 ====================

function VerticalLine({ height = 28 }: { height?: number }) {
  return (
    <div className="flex justify-center" style={{ height }}>
      <div className="bg-[#8b4513] h-full" style={{ width: "3px" }} />
    </div>
  );
}

function HorizontalLine({ width = 16 }: { width?: number }) {
  return (
    <div className="flex items-center" style={{ width }}>
      <div className="bg-[#8b4513] flex-1" style={{ height: "3px" }} />
    </div>
  );
}

function ConnectorDot({ size = 8 }: { size?: number }) {
  return (
    <div
      className="rounded-full bg-[#8b4513]"
      style={{ width: size, height: size, minWidth: size }}
    />
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
            // 不在编辑模式：打开详情弹窗同时请求父页面进入编辑模式
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

      {/* 详情弹窗：点击卡片时显示 */}
      {showDetail && (
        <div
          className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 text-sm text-[#5c3a2e] leading-relaxed"
          onClick={(e) => e.stopPropagation()}
          style={{ minWidth: "200px" }}
        >
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-[#d4a76a]/20 rotate-45" />
          
          {/* 姓名 */}
          <p className="font-bold text-[#8b0000] mb-1 text-base">{member.name}</p>
          
          {/* 生卒年份 */}
          {birthText && (
            <p className="text-xs text-[#5c3a2e]/60 mb-2">{birthText}</p>
          )}

          {/* 安葬地 */}
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
                  // 触发父级照片上传流程
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

          {/* 生平事迹 / AI 生成的小传 */}
          {member.info && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">📜 生平</p>
              <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">
                {member.info}
              </p>
            </div>
          )}

          {/* 家族故事：前50字 + 展开全文 */}
          {member.story && (
            <StoryBlock story={member.story} />
          )}

          {/* 家人回忆 */}
          <MemberMemories
            member={member}
            editable={editable}
            onUpdateMember={onUpdateMember}
          />

          {/* 关闭按钮 */}
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

// ==================== 子女组合（带连线、分叉圆点） ====================

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
    <div className="relative flex flex-col items-center w-full">
      {/* 向下连线 + 分叉 */}
      <div className="flex items-center justify-center w-full py-1">
        {children.length === 1 ? (
          <ConnectorDot size={8} />
        ) : (
          <div className="flex items-center justify-center" style={{ width: "100%" }}>
            <ConnectorDot size={6} />
            <div className="flex-1 bg-[#8b4513]" style={{ height: "3px" }} />
            <ConnectorDot size={6} />
            <div className="flex-1 bg-[#8b4513]" style={{ height: "3px" }} />
            <ConnectorDot size={6} />
          </div>
        )}
      </div>

      {/* 子女卡片行 */}
      <div className="flex items-start gap-6 md:gap-8">
        {children.map((child) => {
          const spouse = child.spouse;
          return (
            <div key={child.member.id} className="flex flex-col items-center">
              <VerticalLine height={20} />
              <div className="flex items-center gap-1">
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
                {spouse && (
                  <>
                    <div className="flex items-center">
                      <HorizontalLine width={12} />
                      <span className="text-[#8b4513] text-[11px] font-bold mx-0.5">配</span>
                      <HorizontalLine width={12} />
                    </div>
                    <MemberCard
                      member={spouse.member}
                      isSpouse
                      editable={editable}
                      onEdit={() => onEditMember(spouse.member)}
                      onEditStory={() => onEditStory(spouse.member)}
                      onAddParent={() => onAddParent(spouse.member)}
                      onAddChild={() => onAddChild(spouse.member)}
                      onAddSpouse={() => onAddSpouse(spouse.member)}
                      onRequestEdit={onRequestEdit}
                      onUpdateMember={onUpdateMember}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 夫妻组（横向连"配"） ====================

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

  return (
    <div className="flex flex-col items-center">
      {/* 夫妻行 */}
      <div className="flex items-center gap-1">
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
        {husband && wife && (
          <div className="flex items-center">
            <ConnectorDot size={5} />
            <HorizontalLine width={10} />
            <span className="text-[#8b4513] text-xs font-bold mx-0.5 tracking-widest">配</span>
            <HorizontalLine width={10} />
            <ConnectorDot size={5} />
          </div>
        )}
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
      </div>

      {/* 向下连线 */}
      {children.length > 0 && (
        <>
          <VerticalLine height={24} />
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

// ==================== 代际行（同辈折叠） ====================

const COLLAPSE_THRESHOLD = 6;

function GenerationRowView({
  couples,
  generation,
  isLast,
  editable,
  onEditMember,
  onEditStory,
  onAddParent,
  onAddChild,
  onAddSpouse,
  onRequestEdit,
  onUpdateMember,
}: {
  couples: CoupleGroup[];
  generation: number;
  isLast: boolean;
  editable: boolean;
  onEditMember: (m: Member) => void;
  onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void;
  onAddChild: (m: Member) => void;
  onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void;
  onUpdateMember?: (updated: Member) => void;
}) {
  const totalIndividuals = couples.reduce(
    (sum, c) => sum + (c.husband ? 1 : 0) + (c.wife ? 1 : 0),
    0
  );
  const [collapsed, setCollapsed] = useState(totalIndividuals > COLLAPSE_THRESHOLD * 1.5);
  const displayCouples = collapsed ? couples.slice(0, 3) : couples;
  const hiddenCount = couples.length - displayCouples.length;
  const hiddenMembers = couples
    .slice(3)
    .reduce((sum, c) => sum + (c.husband ? 1 : 0) + (c.wife ? 1 : 0), 0);

  return (
    <div className="flex flex-col items-center w-full">
      {/* 代际标签 */}
      <div className="text-[11px] text-[#8b4513]/60 tracking-widest mb-2 font-bold px-3 py-0.5 bg-[#f5f0e8] rounded-full border border-[#d4a76a]/20">
        {getGenerationLabel(generation)}
      </div>

      {/* 上一代指向本代的连线 */}
      {generation > 0 && <VerticalLine height={28} />}

      {/* 夫妻组 */}
      <div className="flex items-start gap-8 md:gap-12 px-4 overflow-x-auto py-2">
        {displayCouples.map((couple, idx) => (
          <div key={idx} className="flex items-center shrink-0">
            {idx > 0 && <div className="w-4 bg-[#8b4513]/20 mx-1" style={{ height: "3px" }} />}
            <CoupleUnit
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
          </div>
        ))}
      </div>

      {/* 折叠展开按钮 */}
      {collapsed && hiddenCount > 0 && (
        <button
          onClick={() => setCollapsed(false)}
          className="mt-2 px-4 py-1.5 text-xs text-[#c4a67a] hover:text-[#8b0000] bg-white/80 rounded-full border border-[#d4a76a]/20 hover:border-[#8b0000]/30 transition-colors shadow-sm"
        >
          展开剩余 {hiddenMembers} 位族人...
        </button>
      )}
      {!collapsed && totalIndividuals > COLLAPSE_THRESHOLD * 1.5 && (
        <button
          onClick={() => setCollapsed(true)}
          className="mt-2 px-4 py-1.5 text-xs text-[#c4a67a] hover:text-[#8b0000] bg-white/80 rounded-full border border-[#d4a76a]/20 hover:border-[#8b0000]/30 transition-colors shadow-sm"
        >
          折叠
        </button>
      )}

      {/* 代际分隔 */}
      {!isLast && (
        <div className="w-full max-w-3xl mx-auto mt-4 mb-2">
          <div className="h-px bg-gradient-to-r from-transparent via-[#8b4513]/20 to-transparent" />
        </div>
      )}
    </div>
  );
}

// ==================== 全部族人一览 ====================

function MembersOverview({ members }: { members: Member[] }) {
  return (
    <div className="mt-8 pt-6 border-t border-[#d4a76a]/20">
      <h3 className="text-sm font-bold text-[#5c3a2e] mb-4 tracking-wider">
        全部族人一览
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="px-3 py-2 bg-[#f5f0e8] rounded-lg text-center text-sm text-[#5c3a2e] hover:bg-[#e8dcc8] transition-colors"
          >
            <div className="font-bold text-[#8b0000]">{m.name}</div>
            {m.birth && (
              <div className="text-xs text-[#5c3a2e]/60">
                {m.birth}
                {m.death ? `—${m.death}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== 空状态 ====================

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="text-6xl mb-4">🏛️</div>
      <h3 className="text-xl font-bold text-[#8b0000] mb-2 tracking-wider">
        家族树暂无数据
      </h3>
      <p className="text-[#5c3a2e] text-sm">
        点击编辑开始添加成员
      </p>
    </div>
  );
}

// ==================== 故事展开块（前50字摘要 + 点击全文） ====================

function StoryBlock({ story }: { story: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = story.length > 50;
  const display = expanded || !isLong ? story : story.slice(0, 50) + "…";

  return (
    <div className="bg-[#fefcf5] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
      <p className="text-xs font-bold text-[#8b0000]/70 mb-1">📖 家族故事</p>
      <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">
        {display}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[#8b0000] font-bold ml-1 hover:text-[#a52a2a] transition-colors"
          >
            {expanded ? "收起" : "阅读全文"}
          </button>
        )}
      </p>
    </div>
  );
}

// ==================== 主视图 - 宝塔式树状图 ====================

export function PagodaTreeView({
  tree,
  editable = false,
  onTreeChange,
  onRequestEdit,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (newTree: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  const [formMode, setFormMode] = useState<"edit" | "addParent" | "addChild" | "addSpouse" | "addRoot" | "editStory" | null>(null);
  const [currentMember, setCurrentMember] = useState<Member | null>(null);
  const [editTargetMemberId, setEditTargetMemberId] = useState<string | null>(null);
  const [storyFocusMemberId, setStoryFocusMemberId] = useState<string | null>(null);

  // 克隆成员列表
  const members = tree.members || [];

  // 构建树
  const generations = useMemo(() => buildPagodaTree(members), [members]);

  const setMembers = useCallback(
    (newMembers: Member[]) => {
      onTreeChange?.({
        ...tree,
        members: newMembers,
        updatedAt: new Date().toISOString(),
      });
    },
    [tree, onTreeChange]
  );

  // ===== 编辑现有成员 =====
  const handleEditMember = useCallback((member: Member) => {
    setCurrentMember({ ...member });
    setFormMode("edit");
    setEditTargetMemberId(member.id);
  }, []);

  // ===== 编辑故事 =====
  const handleEditStory = useCallback((member: Member) => {
    setCurrentMember({ ...member });
    setFormMode("editStory");
    setEditTargetMemberId(member.id);
    setStoryFocusMemberId(member.id);
  }, []);

  // ===== 添加父辈 =====
  const handleAddParent = useCallback((member: Member) => {
    setCurrentMember(null);
    setFormMode("addParent");
    setEditTargetMemberId(member.id);
  }, []);

  // ===== 添加子女 =====
  const handleAddChild = useCallback((member: Member) => {
    setCurrentMember({ ...member });
    setFormMode("addChild");
    setEditTargetMemberId(member.id);
  }, []);

  // ===== 添加配偶 =====
  const handleAddSpouse = useCallback((member: Member) => {
    setCurrentMember({ ...member });
    setFormMode("addSpouse");
    setEditTargetMemberId(member.id);
  }, []);

  // ===== 添加始祖 =====
  const handleAddRoot = useCallback(() => {
    setCurrentMember(null);
    setFormMode("addRoot");
    setEditTargetMemberId(null);
  }, []);

  // ===== 保存编辑结果 =====
  const handleSaveEdit = useCallback(
    (data: EditFormData) => {
      // 先从其他成员中移除旧关系引用
      let updated = members.map((m) => {
        if (m.id === editTargetMemberId) {
          return m; // 先不处理目标成员
        }
        // 从 childrenIds 中移除 (old)
        if (m.childrenIds?.includes(editTargetMemberId!)) {
          return { ...m, childrenIds: m.childrenIds.filter((id) => id !== editTargetMemberId) };
        }
        // 从 spouseId 中解除 (old)
        if (m.spouseId === editTargetMemberId) {
          return { ...m, spouseId: undefined };
        }
        return m;
      });

      // 更新目标成员自身
      updated = updated.map((m) => {
        if (m.id === editTargetMemberId) {
          return {
            ...m,
            name: data.name,
            birth: data.birth,
            death: data.death,
            info: data.info,
            story: data.story,
            burialPlace: data.burialPlace,
            burialCoords: data.burialCoords,
            updatedAt: new Date().toISOString(),
          };
        }
        return m;
      });

      // 重新建立新关系引用 (如果编辑表单中包含了关系字段)
      // 注意：Pagoda 的编辑表单不包含 fatherId/motherId/spouseId 选择器，
      // 所以这里只做基本信息编辑。如果未来表单扩展了关系字段，这里需要同步。
      // （关系维护主要在 addChild/addSpouse/addParent 中完成）

      setMembers(updated);
      setFormMode(null);
      setCurrentMember(null);
      setEditTargetMemberId(null);
      setStoryFocusMemberId(null);
    },
    [members, editTargetMemberId, setMembers]
  );

  // ===== 保存故事编辑 =====
  const handleSaveStory = useCallback(
    (data: EditFormData) => {
      handleSaveEdit(data);
    },
    [handleSaveEdit]
  );

  // ===== 添加父辈 =====
  const handleAddParentSave = useCallback(
    (data: EditFormData) => {
      const newId = generateId();
      const newMember: Member = {
        id: newId,
        name: data.name,
        birth: data.birth,
        death: data.death,
        info: data.info,
        story: data.story,
        burialPlace: data.burialPlace,
        burialCoords: data.burialCoords,
        parentId: undefined,
        spouseOf: undefined,
        // 新父辈的 childrenIds 包含当前成员
        childrenIds: editTargetMemberId ? [editTargetMemberId] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // 同时更新当前成员的 parentId 指向新父辈
      const updatedMembers = members.map((m) => {
        if (m.id === editTargetMemberId) {
          return { ...m, parentId: newId };
        }
        return m;
      });
      setMembers([...updatedMembers, newMember]);
      setFormMode(null);
      setCurrentMember(null);
      setEditTargetMemberId(null);
    },
    [members, editTargetMemberId, setMembers]
  );

  // ===== 添加子女 =====
  const handleAddChildSave = useCallback(
    (data: EditFormData) => {
      const newId = generateId();
      const newMember: Member = {
        id: newId,
        name: data.name,
        birth: data.birth,
        death: data.death,
        info: data.info,
        story: data.story,
        burialPlace: data.burialPlace,
        burialCoords: data.burialCoords,
        parentId: editTargetMemberId,
        spouseOf: undefined,
        childrenIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // 双向：在父辈的 childrenIds 中加入新子女
      const updatedMembers = members.map((m) => {
        if (m.id === editTargetMemberId) {
          const childrenIds = m.childrenIds || [];
          if (!childrenIds.includes(newId)) {
            return { ...m, childrenIds: [...childrenIds, newId] };
          }
        }
        return m;
      });
      setMembers([...updatedMembers, newMember]);
      setFormMode(null);
      setCurrentMember(null);
      setEditTargetMemberId(null);
    },
    [members, editTargetMemberId, setMembers]
  );

  // ===== 添加配偶 =====
  const handleAddSpouseSave = useCallback(
    (data: EditFormData) => {
      const newId = generateId();
      const newMember: Member = {
        id: newId,
        name: data.name,
        birth: data.birth,
        death: data.death,
        info: data.info,
        story: data.story,
        burialPlace: data.burialPlace,
        burialCoords: data.burialCoords,
        parentId: currentMember?.parentId || null,
        spouseOf: editTargetMemberId,
        childrenIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // 双向：在原有成员的 spouseId 中设置新配偶
      const updatedMembers = members.map((m) => {
        if (m.id === editTargetMemberId) {
          return { ...m, spouseId: newId };
        }
        return m;
      });
      setMembers([...updatedMembers, newMember]);
      setFormMode(null);
      setCurrentMember(null);
      setEditTargetMemberId(null);
    },
    [members, currentMember, editTargetMemberId, setMembers]
  );

  // ===== 更新单个成员（用于家人回忆） =====
  const handleUpdateMember = useCallback(
    (updated: Member) => {
      const newMembers = members.map((m) =>
        m.id === updated.id ? { ...m, ...updated } : m
      );
      setMembers(newMembers);
    },
    [members, setMembers]
  );

  // ===== 添加始祖（无parentId，无配偶） =====
  const handleAddRootSave = useCallback(
    (data: EditFormData) => {
      const newMember: Member = {
        id: generateId(),
        name: data.name,
        birth: data.birth,
        death: data.death,
        info: data.info,
        story: data.story,
        burialPlace: data.burialPlace,
        burialCoords: data.burialCoords,
        parentId: null,
        spouseOf: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setMembers([...members, newMember]);
      setFormMode(null);
      setCurrentMember(null);
      setEditTargetMemberId(null);
    },
    [members, setMembers]
  );

  // ===== 渲染表单 =====
  const renderForm = () => {
    if (formMode === "edit" || formMode === "editStory") {
      const member = members.find((m) => m.id === editTargetMemberId);
      if (!member) return null;
      return (
        <MemberEditForm
          initial={{
            name: member.name,
            birth: member.birth || "",
            death: member.death || "",
            info: member.info || "",
            story: member.story || "",
            burialPlace: member.burialPlace || "",
            burialCoords: member.burialCoords || "",
          }}
          onSave={formMode === "editStory" ? handleSaveStory : handleSaveEdit}
          onCancel={() => { setFormMode(null); setCurrentMember(null); setEditTargetMemberId(null); setStoryFocusMemberId(null); }}
          title={formMode === "editStory" ? `📖 ${member.name} 的故事` : `✏️ 编辑 ${member.name}`}
          storyFocus={formMode === "editStory"}
        />
      );
    }
    if (formMode === "addParent") {
      return (
        <MemberEditForm
          initial={{ name: "", birth: "", death: "", info: "", story: "", burialPlace: "", burialCoords: "" }}
          onSave={handleAddParentSave}
          onCancel={() => { setFormMode(null); setCurrentMember(null); setEditTargetMemberId(null); }}
          title="⬆️ 添加父辈"
        />
      );
    }
    if (formMode === "addChild") {
      return (
        <MemberEditForm
          initial={{ name: "", birth: "", death: "", info: "", story: "", burialPlace: "", burialCoords: "" }}
          onSave={handleAddChildSave}
          onCancel={() => { setFormMode(null); setCurrentMember(null); setEditTargetMemberId(null); }}
          title="⬇️ 添加子女"
        />
      );
    }
    if (formMode === "addSpouse") {
      return (
        <MemberEditForm
          initial={{ name: "", birth: "", death: "", info: "", story: "", burialPlace: "", burialCoords: "" }}
          onSave={handleAddSpouseSave}
          onCancel={() => { setFormMode(null); setCurrentMember(null); setEditTargetMemberId(null); }}
          title="👩‍❤️‍👨 添加配偶"
        />
      );
    }
    if (formMode === "addRoot") {
      return (
        <MemberEditForm
          initial={{ name: "", birth: "", death: "", info: "", story: "", burialPlace: "", burialCoords: "" }}
          onSave={handleAddRootSave}
          onCancel={() => { setFormMode(null); setCurrentMember(null); setEditTargetMemberId(null); }}
          title="🏛️ 添加始祖"
        />
      );
    }
    return null;
  };

  return (
    <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8">
      {/* 标题 */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">🌳</span>
          <h2 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider">
            宝塔式宗亲世系图
          </h2>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mt-2 mb-2" />
        <p className="text-[#5c3a2e] text-sm">
          共计 {members.length} 位族人 · {generations.length} 代
        </p>
      </div>

      {/* 编辑模式：添加始祖 */}
      {editable && members.length === 0 && (
        <div className="text-center mb-6">
          <button
            onClick={handleAddRoot}
            className="px-6 py-3 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors shadow-lg shadow-[#8b0000]/20"
          >
            🏛️ 添加始祖
          </button>
        </div>
      )}

      {/* 空状态 */}
      {members.length === 0 && !editable && <EmptyState />}

      {/* 树图主体 */}
      {members.length > 0 && (
        <div className="overflow-x-auto pb-6">
          <div className="flex flex-col items-center min-w-[300px]">
            {generations.map((gen, index) => (
            <GenerationRowView
                key={gen.generation}
                couples={gen.couples}
                generation={gen.generation}
                isLast={index === generations.length - 1}
                editable={editable}
                onEditMember={handleEditMember}
                onEditStory={handleEditStory}
                onAddParent={handleAddParent}
                onAddChild={handleAddChild}
                onAddSpouse={handleAddSpouse}
                onRequestEdit={onRequestEdit}
                onUpdateMember={handleUpdateMember}
              />
            ))}
          </div>
        </div>
      )}

      {/* 全部族人一览 */}
      {members.length > 0 && <MembersOverview members={members} />}

      {/* 编辑模式：底部添加始祖按钮 */}
      {editable && members.length > 0 && (
        <div className="text-center mt-6">
          <button
            onClick={handleAddRoot}
            className="px-5 py-2.5 bg-white text-[#8b0000] rounded-xl font-bold text-sm hover:bg-[#fdfbf7] transition-colors border-2 border-[#8b0000]/30 hover:border-[#8b0000] shadow-lg"
          >
            🏛️ 添加始祖
          </button>
        </div>
      )}

      {/* 表单弹窗 */}
      {renderForm()}
    </div>
  );
}

export const displayPagodaTooltip = (member: Member) => {
  const parts: string[] = [];
  if (member.birth) parts.push(`生于 ${member.birth}`);
  if (member.death) parts.push(`卒于 ${member.death}`);
  if (member.info) parts.push(member.info);
  return parts.join("\n");
};
