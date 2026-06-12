"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { getImageUrls, createImgFallback } from "@/lib/ipfsGateway";
import type { Member, FamilyTree } from "@/types/family";
import MemberMemories from "./MemberMemories";

// ==================== 类型定义 ====================

interface TreeNode {
  member: Member;
  generation: number;
  children: TreeNode[];
  spouse: TreeNode | null;
}

interface CoupleGroup {
  husband: TreeNode | null;
  wife: TreeNode | null;
  children: TreeNode[];
}

interface GenerationRow {
  generation: number;
  couples: CoupleGroup[];
}

// ==================== 工具函数 ====================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sortByBirth(a: Member, b: Member) {
  const ay = a.birth ? parseInt(a.birth) : 9999;
  const by = b.birth ? parseInt(b.birth) : 9999;
  return ay - by;
}

const MAX_GENERATION = 30;

function getChildIds(member: Member, members: Member[]): string[] {
  const ids = new Set<string>();
  if (member.childrenIds) {
    for (const cid of member.childrenIds) ids.add(cid);
  }
  for (const m of members) {
    if (m.parentId === member.id ||
        m.fatherId === member.id ||
        m.motherId === member.id) {
      ids.add(m.id);
    }
  }
  return Array.from(ids);
}

// ==================== 核心树构建（彻底重写代际分层算法） ====================

function buildPagodaTree(members: Member[]): GenerationRow[] {
  if (members.length === 0) return [];

  // 1. 建节点索引
  const nodeMap = new Map<string, TreeNode>();
  for (const m of members) {
    nodeMap.set(m.id, {
      member: m,
      generation: -1,
      children: [],
      spouse: null,
    });
  }

  // 2. 配偶关联（双向）
  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id)!;
      const spouseNode = nodeMap.get(m.spouseOf)!;
      node.spouse = spouseNode;
      spouseNode.spouse = node;
    }
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id)!;
      const spouseNode = nodeMap.get(m.spouseId)!;
      node.spouse = spouseNode;
      spouseNode.spouse = node;
    }
  }

  // =============================================================
  // 3. 代际分层算法（核心重写）
  // =============================================================
  const assigned = new Set<string>();

  // 3a. 第1代：fatherId 和 motherId 都为空
  const gen0Ids: string[] = [];
  for (const m of members) {
    const fatherEmpty = !m.fatherId || m.fatherId === "";
    const motherEmpty = !m.motherId || m.motherId === "";
    if (fatherEmpty && motherEmpty) {
      gen0Ids.push(m.id);
    }
  }

  // 回退：没人同时满足时，找非子女成员
  if (gen0Ids.length === 0) {
    const isChildOfSomeone = new Set<string>();
    for (const m of members) {
      for (const cid of getChildIds(m, members)) {
        isChildOfSomeone.add(cid);
      }
    }
    for (const m of members) {
      if (!isChildOfSomeone.has(m.id)) {
        gen0Ids.push(m.id);
      }
    }
  }

  // 3b. BFS 分配代际
  const queue: { nodeId: string; gen: number }[] = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift()!;
    if (assigned.has(nodeId)) continue;
    if (gen > MAX_GENERATION) continue;

    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    node.generation = gen;

    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }

    const childIds = getChildIds(node.member, members);
    for (const cid of childIds) {
      const childNode = nodeMap.get(cid);
      if (childNode && !assigned.has(cid)) {
        node.children.push(childNode);
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }

    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) {
        const childNode = nodeMap.get(cid);
        if (childNode && !assigned.has(cid)) {
          if (!node.children.some((c) => c.member.id === cid)) {
            node.children.push(childNode);
          }
          queue.push({ nodeId: cid, gen: gen + 1 });
        }
      }
    }
  }

  // 3c. 处理孤立节点
  const unassigned = members.filter((m) => !assigned.has(m.id));
  if (unassigned.length > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of unassigned) {
        if (assigned.has(m.id)) continue;
        const node = nodeMap.get(m.id);
        if (!node) continue;

        let targetGen: number | null = null;

        if (node.spouse && assigned.has(node.spouse.member.id)) {
          targetGen = node.spouse.generation;
        }

        if (targetGen === null) {
          let minChildGen = Infinity;
          for (const cid of getChildIds(m, members)) {
            const cn = nodeMap.get(cid);
            if (cn && assigned.has(cid)) minChildGen = Math.min(minChildGen, cn.generation);
          }
          if (minChildGen < Infinity) targetGen = minChildGen - 1;
        }

        if (targetGen === null) {
          let maxParentGen = -1;
          const fn = m.fatherId ? nodeMap.get(m.fatherId) : null;
          const mn = m.motherId ? nodeMap.get(m.motherId) : null;
          const pn = m.parentId ? nodeMap.get(m.parentId) : null;
          if (fn && assigned.has(fn.member.id)) maxParentGen = Math.max(maxParentGen, fn.generation);
          if (mn && assigned.has(mn.member.id)) maxParentGen = Math.max(maxParentGen, mn.generation);
          if (pn && assigned.has(pn.member.id)) maxParentGen = Math.max(maxParentGen, pn.generation);
          if (maxParentGen >= 0) targetGen = maxParentGen + 1;
        }

        if (targetGen !== null && targetGen >= 0) {
          node.generation = targetGen;
          assigned.add(m.id);
          changed = true;
        }
      }
    }

    for (const m of unassigned) {
      if (!assigned.has(m.id)) {
        const node = nodeMap.get(m.id);
        if (node) {
          node.generation = 0;
          assigned.add(m.id);
          if (node.spouse && !assigned.has(node.spouse.member.id)) {
            node.spouse.generation = 0;
            assigned.add(node.spouse.member.id);
          }
        }
      }
    }
  }

  // 3d. 重建父子关系
  for (const [, node] of nodeMap) node.children = [];
  for (const [, node] of nodeMap) {
    const m = node.member;
    for (const cid of getChildIds(m, members)) {
      const cn = nodeMap.get(cid);
      if (cn && assigned.has(cid) && !node.children.some((c) => c.member.id === cid)) {
        node.children.push(cn);
      }
    }
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) {
        const cn = nodeMap.get(cid);
        if (cn && assigned.has(cid) && !node.children.some((c) => c.member.id === cid)) {
          node.children.push(cn);
        }
      }
    }
  }

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  // 5. 按代际分组
  const genMap = new Map<number, TreeNode[]>();
  for (const [, node] of nodeMap) {
    if (!assigned.has(node.member.id)) continue;
    const gen = node.generation;
    if (!genMap.has(gen)) genMap.set(gen, []);
    genMap.get(gen)!.push(node);
  }

  const generations: GenerationRow[] = [];
  for (const gen of Array.from(genMap.keys()).sort((a, b) => a - b)) {
    generations.push({ generation: gen, couples: buildCoupleGroups(genMap.get(gen)!) });
  }

  return generations;
}

function buildCoupleGroups(nodes: TreeNode[]): CoupleGroup[] {
  const groups: CoupleGroup[] = [];
  const used = new Set<string>();
  for (const node of nodes) {
    if (used.has(node.member.id)) continue;
    if (node.spouse && !used.has(node.spouse.member.id)) {
      const sn = node.spouse;
      const isHusband = node.member.gender === "男" ||
        (sn.member.gender === "女" && node.member.gender !== "女") ||
        node.member.id < sn.member.id;
      groups.push({ husband: isHusband ? node : sn, wife: isHusband ? sn : node, children: node.children });
      used.add(node.member.id);
      used.add(sn.member.id);
    } else {
      groups.push({ husband: node, wife: null, children: node.children });
      used.add(node.member.id);
    }
  }
  return groups;
}

// ==================== 代际标签 ====================

function getGenerationLabel(gen: number): string {
  const labels = ["第一代", "第二代", "第三代", "第四代", "第五代", "第六代", "第七代", "第八代", "第九代", "第十代"];
  return gen < labels.length ? labels[gen] : `${gen + 1}世`;
}

// ==================== 连线组件（深棕色 2px 实线） ====================

const LINE_COLOR = "#4a2c17";
const LINE_WIDTH = 2;

function VerticalLine({ height = 28 }: { height?: number }) {
  return (
    <div className="flex justify-center" style={{ height }}>
      <div style={{ backgroundColor: LINE_COLOR, height: "100%", width: LINE_WIDTH }} />
    </div>
  );
}

function HorizontalLine({ width = 16 }: { width?: number }) {
  return (
    <div className="flex items-center" style={{ width }}>
      <div style={{ backgroundColor: LINE_COLOR, flex: 1, height: LINE_WIDTH }} />
    </div>
  );
}

function ConnectorDot({ size = 8 }: { size?: number }) {
  return (
    <div className="rounded-full" style={{ width: size, height: size, minWidth: size, backgroundColor: LINE_COLOR }} />
  );
}

function SiblingLine({ length = 40 }: { length?: number }) {
  return (
    <div className="flex items-center" style={{ width: length }}>
      <div style={{ backgroundColor: "#c4b5a0", flex: 1, height: 1 }} />
    </div>
  );
}

// ==================== StoryBlock ====================

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
  const hasDeath = death.trim().length > 0;

  useEffect(() => {
    if (storyFocus && storyRef.current) {
      setTimeout(() => {
        storyRef.current?.focus();
        storyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, [storyFocus]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-[#8b0000] mb-4 tracking-wider">{title}</h3>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">姓名 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="输入姓名" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">出生年份</label>
            <input type="text" value={birth} onChange={(e) => setBirth(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：1950" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">逝世年份</label>
            <input type="text" value={death} onChange={(e) => setDeath(e.target.value)}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：2020" />
          </div>

          {hasDeath && (
            <>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">🪦 安葬地</label>
                <input type="text" value={burialPlace} onChange={(e) => setBurialPlace(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：河北保定某陵园" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5c3a2e] mb-1">安葬地坐标（可选）</label>
                <input type="text" value={burialCoords} onChange={(e) => setBurialCoords(e.target.value)}
                  className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="纬度,经度" />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">生平简介</label>
            <textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" placeholder="输入生平简介" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">📖 我的故事（可选）</label>
            <textarea ref={storyRef} value={story} onChange={(e) => setStory(e.target.value)} rows={4}
              className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" placeholder="讲述您的家族故事、人生经历、难忘回忆……" />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => { if (!name.trim()) return; onSave({ name: name.trim(), birth, death, info, story: story.trim() || "", burialPlace: burialPlace.trim() || "", burialCoords: burialCoords.trim() || "" }); }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40">保存</button>
          <button onClick={onCancel}
            className="px-4 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors">取消</button>
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

  const birthText = member.birth && member.death ? `${member.birth}—${member.death}`
    : member.birth ? `生于 ${member.birth}` : member.death ? `卒于 ${member.death}` : null;

  return (
    <div className="relative flex flex-col items-center">
      {editable && (
        <div className="relative mb-0.5">
          <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="w-5 h-5 rounded-full bg-[#8b0000] text-white text-[10px] font-bold shadow-md hover:bg-[#a52a2a] transition-colors flex items-center justify-center" title="操作">+</button>
          {menuOpen && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-1.5 flex gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { onEdit?.(); setMenuOpen(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors">✏️ 编辑</button>
              <button onClick={() => { onAddParent?.(); setMenuOpen(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors">⬆️ 父辈</button>
              <button onClick={() => { onAddChild?.(); setMenuOpen(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors">⬇️ 子嗣</button>
              <button onClick={() => { onAddSpouse?.(); setMenuOpen(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8] transition-colors">👩‍❤️‍👨 配偶</button>
            </div>
          )}
        </div>
      )}

      <button onClick={(e) => { e.stopPropagation(); if (editable) onEditStory?.(); else { onRequestEdit?.(); onEdit?.(); } }}
        className="text-xs mb-0.5 hover:scale-110 transition-transform"
        title={member.story ? "查看故事" : "写故事"}>
        {member.story ? "📖" : "✏️ 写故事"}
      </button>

      <div className={`px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-200 border-2 select-none min-w-[80px] text-center relative ${editable ? "ring-2 ring-[#8b0000]/20" : ""} ${isSpouse ? "bg-rose-50/80 border-rose-300/50 hover:border-rose-400" : "bg-white border-[#d4a76a] hover:border-[#8b0000] hover:shadow-lg"} hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]`}
        onClick={() => setShowDetail(!showDetail)}>
        <div className={`font-bold tracking-wider ${isSpouse ? "text-rose-700 text-sm" : "text-[#8b0000] text-base"}`}>
          {member.name}
        </div>
        {birthText && <div className="text-[10px] text-[#5c3a2e]/50 mt-0.5 leading-tight">{birthText}</div>}
      </div>

      {showDetail && (
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 text-sm text-[#5c3a2e] leading-relaxed" onClick={(e) => e.stopPropagation()} style={{ minWidth: "200px" }}>
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-[#d4a76a]/20 rotate-45" />
          <p className="font-bold text-[#8b0000] mb-1 text-base">{member.name}</p>
          {birthText && <p className="text-xs text-[#5c3a2e]/60 mb-2">{birthText}</p>}

          {member.burialPlace && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">🪦 安葬地</p>
              {member.burialCoords ? (
                <a href={`https://www.google.com/maps?q=${member.burialCoords}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[#8b0000] underline hover:text-[#a52a2a]">{member.burialPlace} 📍</a>
              ) : <p className="text-xs text-[#5c3a2e]/80">{member.burialPlace}</p>}
            </div>
          )}

          <div className="mb-3">
            {member.photoOriginal || member.photoRestored ? (
              <>
                <div className="relative w-full h-36 rounded-lg overflow-hidden bg-[#f5f0e8] border border-[#d4a76a]/20">
                  <img src={getImageUrls(member.photoRestored || member.photoOriginal || "")[0]}
                    onError={createImgFallback(getImageUrls(member.photoRestored || member.photoOriginal || ""))}
                    alt={member.name} className="w-full h-full object-contain" />
                </div>
                {member.photoOriginal && member.photoRestored && member.photoRestored !== member.photoOriginal &&
                  <p className="text-[10px] text-green-600 mt-1 text-center">✨ AI 修复版</p>}
              </>
            ) : editable ? (
              <div className="w-full h-24 rounded-lg border-2 border-dashed border-[#d4a76a]/40 bg-[#fdfbf7] flex flex-col items-center justify-center cursor-pointer hover:border-[#8b0000]/50 hover:bg-[#f5f0e8] transition-all"
                onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const fd = new FormData(); fd.append('photo', file); fd.append('memberId', member.id); try { const r = await fetch('/api/upload-photo', { method: 'POST', body: fd }); const d = await r.json(); if (d.cid) alert('照片上传成功！请保存修订以永久保存。'); else alert(d.error || '上传失败'); } catch { alert('网络异常'); } }; input.click(); }}>
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
              <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">{member.info}</p>
            </div>
          )}

          {member.story && <StoryBlock story={member.story} />}

          <MemberMemories member={member} editable={editable} onUpdateMember={onUpdateMember} />

          <button className="w-full mt-1 text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors py-1"
            onClick={() => setShowDetail(false)}>关闭</button>
        </div>
      )}
    </div>
  );
}

// ==================== 夫妻组（父亲在左、母亲在右） ====================

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
          <MemberCard member={husband.member} editable={editable}
            onEdit={() => onEditMember(husband.member)}
            onEditStory={() => onEditStory(husband.member)}
            onAddParent={() => onAddParent(husband.member)}
            onAddChild={() => onAddChild(husband.member)}
            onAddSpouse={() => onAddSpouse(husband.member)}
            onRequestEdit={onRequestEdit} onUpdateMember={onUpdateMember} />
        )}
        {husband && wife && (
          <div className="flex items-center">
            <ConnectorDot size={5} />
            <HorizontalLine width={10} />
            <span className="text-[#4a2c17] text-xs font-bold mx-0.5 tracking-wider">配</span>
            <HorizontalLine width={10} />
            <ConnectorDot size={5} />
          </div>
        )}
        {wife && (
          <MemberCard member={wife.member} isSpouse editable={editable}
            onEdit={() => onEditMember(wife.member)}
            onEditStory={() => onEditStory(wife.member)}
            onAddParent={() => onAddParent(wife.member)}
            onAddChild={() => onAddChild(wife.member)}
            onAddSpouse={() => onAddSpouse(wife.member)}
            onRequestEdit={onRequestEdit} onUpdateMember={onUpdateMember} />
        )}
      </div>

      {/* 向下连线到子女 */}
      {children.length > 0 && (
        <div className="flex flex-col items-center">
          <div className="flex items-center">
            {husband && wife ? (
              <>
                <HorizontalLine width={40} />
                <ConnectorDot size={6} />
                <HorizontalLine width={40} />
              </>
            ) : husband ? (
              <>
                <ConnectorDot size={6} />
              </>
            ) : wife ? (
              <>
                <ConnectorDot size={6} />
              </>
            ) : null}
          </div>
          <VerticalLine height={24} />
          <ChildrenRow children={children} editable={editable}
            onEditMember={onEditMember} onEditStory={onEditStory}
            onAddParent={onAddParent} onAddChild={onAddChild} onAddSpouse={onAddSpouse}
            onRequestEdit={onRequestEdit} onUpdateMember={onUpdateMember} />
        </div>
      )}
    </div>
  );
}

// ==================== 子女行 ====================

function ChildrenRow({
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
    <div className="flex items-center justify-center">
      {children.map((child, idx) => (
        <div key={child.member.id} className="flex items-center">
          {idx > 0 && <SiblingLine length={12} />}
          <CoupleUnit couple={{
            husband: child,
            wife: child.spouse,
            children: child.children,
          }} editable={editable}
            onEditMember={onEditMember} onEditStory={onEditStory}
            onAddParent={onAddParent} onAddChild={onAddChild} onAddSpouse={onAddSpouse}
            onRequestEdit={onRequestEdit} onUpdateMember={onUpdateMember} />
        </div>
      ))}
    </div>
  );
}

// ==================== 树结构可视化测试面板（调试用） ====================

function TreeDebugPanel({ members }: { members: Member[] }) {
  const [open, setOpen] = useState(false);

  const info = useMemo(() => {
    const tree = buildPagodaTree(members);
    const lines: string[] = [];
    for (const gen of tree) {
      lines.push(`\n${getGenerationLabel(gen.generation)}（${gen.generation}）:`);
      for (const c of gen.couples) {
        const h = c.husband?.member.name ?? "?";
        const w = c.wife?.member.name ?? "";
        const kids = c.children.map((x) => x.member.name).join(", ");
        lines.push(`  ${h}${w ? " 配 " + w : ""}${kids ? " → 子女: " + kids : ""}`);
      }
    }
    return lines.join("\n");
  }, [members]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button onClick={() => setOpen(!open)} className="px-3 py-1.5 bg-[#8b0000] text-white rounded-lg text-xs font-bold hover:bg-[#a52a2a] transition-colors">
        {open ? "关闭调试" : "🔧 树结构调试"}
      </button>
      {open && (
        <div className="mt-2 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 max-w-md max-h-96 overflow-auto">
          <pre className="text-xs text-[#5c3a2e] whitespace-pre-wrap">{info}</pre>
        </div>
      )}
    </div>
  );
}

// ==================== PagodaTreeView 包装组件（供 page.tsx 使用） ====================

export function PagodaTreeView({
  tree,
  editable = false,
  onTreeChange,
  onRequestEdit,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (tree: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  return <FamilyTreePagodaWithDefaults familyTree={tree} editable={editable} onTreeChange={onTreeChange} onRequestEdit={onRequestEdit} />;
}

// ==================== 带默认参数的主组件（供 page.tsx 使用） ====================

function FamilyTreePagodaWithDefaults({
  familyTree,
  editable = false,
  onRevisionCreated,
  onTreeChange,
  onRequestEdit,
}: {
  familyTree: FamilyTree;
  editable?: boolean;
  onRevisionCreated?: () => void;
  onTreeChange?: (tree: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  const [expandedGen, setExpandedGen] = useState<number | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [storyEditingMember, setStoryEditingMember] = useState<Member | null>(null);
  const [addingParentFor, setAddingParentFor] = useState<Member | null>(null);
  const [addingChildFor, setAddingChildFor] = useState<Member | null>(null);
  const [addingSpouseFor, setAddingSpouseFor] = useState<Member | null>(null);

  const generations = useMemo(() => buildPagodaTree(familyTree.members), [familyTree.members]);
  const totalGenerations = generations.length;
  const totalMembers = familyTree.members.length;

  // 自动展开中间代
  useEffect(() => {
    if (generations.length > 0 && expandedGen === null) {
      const mid = Math.floor(generations.length / 2);
      setExpandedGen(generations[mid]?.generation ?? generations[0].generation);
    }
  }, [generations, expandedGen]);

  const updateMemberInTree = useCallback((updatedMember: Member) => {
    if (!onTreeChange) return;
    const newMembers = familyTree.members.map((m) =>
      m.id === updatedMember.id ? updatedMember : m
    );
    onTreeChange({ ...familyTree, members: newMembers });
  }, [familyTree, onTreeChange]);

  const handleSaveEdit = useCallback((data: EditFormData) => {
    if (!editingMember) return;
    updateMemberInTree({
      ...editingMember,
      name: data.name,
      birth: data.birth,
      death: data.death,
      info: data.info,
      story: data.story,
      burialPlace: data.burialPlace,
      burialCoords: data.burialCoords,
    });
    setEditingMember(null);
  }, [editingMember, updateMemberInTree]);

  const handleSaveStory = useCallback((data: EditFormData) => {
    if (!storyEditingMember) return;
    updateMemberInTree({
      ...storyEditingMember,
      name: data.name,
      birth: data.birth,
      death: data.death,
      info: data.info,
      story: data.story,
    });
    setStoryEditingMember(null);
  }, [storyEditingMember, updateMemberInTree]);

  const createNewMember = useCallback((partial: Partial<Member>): Member => ({
    id: generateId(),
    name: "",
    gender: "男",
    birth: "",
    death: "",
    info: "",
    story: "",
    burialPlace: "",
    burialCoords: "",
    childrenIds: [],
    ...partial,
  }), []);

  const handleAddParent = useCallback((member: Member) => {
    if (!onTreeChange) return;
    const parent = createNewMember({ id: generateId(), name: "待编辑", gender: "男" });
    parent.childrenIds = [member.id];
    const newMembers = [...familyTree.members, parent];
    onTreeChange({ ...familyTree, members: newMembers });
    setAddingParentFor(null);
    setEditingMember(parent);
  }, [familyTree, onTreeChange, createNewMember]);

  const handleAddChild = useCallback((member: Member) => {
    if (!onTreeChange) return;
    const child = createNewMember({ id: generateId(), name: "待编辑", gender: "男", parentId: member.id });
    const updatedMembers = familyTree.members.map((m) =>
      m.id === member.id
        ? { ...m, childrenIds: [...(m.childrenIds || []), child.id] }
        : m
    );
    onTreeChange({ ...familyTree, members: [...updatedMembers, child] });
    setAddingChildFor(null);
    setEditingMember(child);
  }, [familyTree, onTreeChange, createNewMember]);

  const handleAddSpouse = useCallback((member: Member) => {
    if (!onTreeChange) return;
    const spouse = createNewMember({
      id: generateId(),
      name: "待编辑",
      gender: member.gender === "男" ? "女" : "男",
      spouseOf: member.id,
    });
    const updatedMembers = familyTree.members.map((m) =>
      m.id === member.id ? { ...m, spouseId: spouse.id } : m
    );
    onTreeChange({ ...familyTree, members: [...updatedMembers, spouse] });
    setAddingSpouseFor(null);
    setEditingMember(spouse);
  }, [familyTree, onTreeChange, createNewMember]);

  if (!familyTree || !familyTree.members || familyTree.members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-[#fdfbf7] rounded-2xl border border-[#d4a76a]/20">
        <span className="text-4xl mb-4">🌳</span>
        <p className="text-[#5c3a2e] text-lg font-bold">暂无家族成员</p>
        <p className="text-[#c4a67a] text-sm mt-1">点击上方「编辑」开始添加</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 树形图主体 */}
      <div className="overflow-x-auto pb-6">
        <div className="flex flex-col items-center min-w-max px-4">
          {generations.map((gen) => (
            <div key={gen.generation} className="flex flex-col items-center">
              {/* 代际标签 + 折叠开关 */}
              <button
                onClick={() => setExpandedGen(expandedGen === gen.generation ? null : gen.generation)}
                className={`group flex items-center gap-2 px-4 py-1.5 mb-2 rounded-full text-sm font-bold transition-all duration-200 tracking-wider
                  ${expandedGen === gen.generation
                    ? "bg-[#8b0000] text-white shadow-md"
                    : "bg-[#f5f0e8] text-[#5c3a2e] border border-[#d4a76a]/30 hover:bg-[#e8dcc8]"
                  }`}
              >
                <span>{getGenerationLabel(gen.generation)}</span>
                <span className={`text-[10px] transition-transform duration-200 ${expandedGen === gen.generation ? "rotate-180" : ""}`}>
                  ▼
                </span>
              </button>

              {/* 代际内容 */}
              <div className={`transition-all duration-300 overflow-hidden ${expandedGen === gen.generation ? "opacity-100 max-h-[2000px] mb-4" : "opacity-0 max-h-0 mb-0"}`}>
                <div className="flex flex-col items-center">
                  {/* 配偶组行 */}
                  <div className="flex items-center justify-center gap-4">
                    {gen.couples.map((couple, idx) => (
                      <div key={`${couple.husband?.member.id ?? "x"}-${couple.wife?.member.id ?? "y"}`} className="flex items-center">
                        {idx > 0 && <SiblingLine length={24} />}
                        <CoupleUnit
                          couple={couple}
                          editable={editable}
                          onEditMember={(m) => setEditingMember(m)}
                          onEditStory={(m) => setStoryEditingMember(m)}
                          onAddParent={(m) => setAddingParentFor(m)}
                          onAddChild={(m) => setAddingChildFor(m)}
                          onAddSpouse={(m) => setAddingSpouseFor(m)}
                          onRequestEdit={onRequestEdit}
                          onUpdateMember={updateMemberInTree}
                        />
                      </div>
                    ))}
                  </div>

                  {/* 代际间连线 */}
                  {gen.generation < totalGenerations - 1 && (
                    <div className="flex justify-center mt-2">
                      <VerticalLine height={32} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑弹窗 */}
      {editingMember && (
        <MemberEditForm
          title={`编辑成员：${editingMember.name || "新成员"}`}
          initial={{
            name: editingMember.name || "",
            birth: editingMember.birth || "",
            death: editingMember.death || "",
            info: editingMember.info || "",
            story: editingMember.story || "",
            burialPlace: editingMember.burialPlace || "",
            burialCoords: editingMember.burialCoords || "",
          }}
          onSave={handleSaveEdit}
          onCancel={() => setEditingMember(null)}
        />
      )}

      {storyEditingMember && (
        <MemberEditForm
          title={`📖 讲述${storyEditingMember.name}的故事`}
          initial={{
            name: storyEditingMember.name || "",
            birth: storyEditingMember.birth || "",
            death: storyEditingMember.death || "",
            info: storyEditingMember.info || "",
            story: storyEditingMember.story || "",
            burialPlace: storyEditingMember.burialPlace || "",
            burialCoords: storyEditingMember.burialCoords || "",
          }}
          onSave={handleSaveStory}
          onCancel={() => setStoryEditingMember(null)}
          storyFocus
        />
      )}

      {/* 信息统计 */}
      <div className="mt-4 px-4 py-2 bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/10 text-center">
        <span className="text-xs text-[#5c3a2e]">
          🌳 共 {totalGenerations} 代 · {totalMembers} 位成员
        </span>
      </div>

      {/* 调试面板 */}
      {process.env.NODE_ENV === "development" && <TreeDebugPanel members={familyTree.members} />}
    </div>
  );
}

// ==================== 默认导出（向后兼容） ====================

const FamilyTreePagoda = FamilyTreePagodaWithDefaults;
export default FamilyTreePagoda;
