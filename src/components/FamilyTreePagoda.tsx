"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Member, FamilyTree } from "@/types/family";
import MemberMemories from "./MemberMemories";
import { getImageUrls, createImgFallback } from "@/lib/ipfsGateway";

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
    if (m.parentId === member.id || m.fatherId === member.id || m.motherId === member.id) {
      ids.add(m.id);
    }
  }
  return Array.from(ids);
}

// ==================== 核心树构建 ====================

function buildPagodaTree(members: Member[]): GenerationRow[] {
  if (members.length === 0) return [];

  const nodeMap = new Map<string, TreeNode>();
  for (const m of members) {
    nodeMap.set(m.id, { member: m, generation: -1, children: [], spouse: null });
  }

  // 配偶关联
  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id)!;
      const sn = nodeMap.get(m.spouseOf)!;
      node.spouse = sn; sn.spouse = node;
    }
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id)!;
      const sn = nodeMap.get(m.spouseId)!;
      node.spouse = sn; sn.spouse = node;
    }
  }

  const assigned = new Set<string>();

  // 找根节点（无父辈的人，排除外嫁/外娶入的配偶）
  const gen0Ids: string[] = [];
  for (const m of members) {
    if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
      // 检查这个人的配偶是否已有父辈信息（说明配偶是家族中的后代）
      // 如果是，则跳过（此人应从配偶的BFS遍历中获得代际）
      const spouseId = m.spouseOf || m.spouseId;
      let spouseHasParent = false;
      if (spouseId) {
        const spouse = members.find(x => x.id === spouseId);
        if (spouse) {
          spouseHasParent = !!(spouse.fatherId && spouse.fatherId !== "") || !!(spouse.motherId && spouse.motherId !== "");
        }
      }
      if (!spouseHasParent) {
        gen0Ids.push(m.id);
      }
    }
  }
  if (gen0Ids.length === 0) {
    const isChild = new Set<string>();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  // BFS 分配代际
  const queue: { nodeId: string; gen: number }[] = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift()!;
    // 关键修复：如果已经分配过，跳过（避免重复出现）
    if (assigned.has(nodeId) || gen > MAX_GENERATION) continue;
    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    node.generation = gen;

    // 配偶同代
    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }

    // 处理子女
    const allChildIds = new Set<string>();
    for (const cid of getChildIds(node.member, members)) allChildIds.add(cid);
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) allChildIds.add(cid);
    }

    for (const cid of allChildIds) {
      const cn = nodeMap.get(cid);
      // 只加入尚未分配的子女
      if (cn && !assigned.has(cid)) {
        // 避免重复添加到 children 列表
        if (!node.children.some(c => c.member.id === cid)) {
          node.children.push(cn);
        }
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

  // 处理孤立节点（没有被任何 BFS 覆盖到的人）
  for (const m of members) {
    if (!assigned.has(m.id)) {
      const node = nodeMap.get(m.id);
      if (node) {
        node.generation = 0; assigned.add(m.id);
        if (node.spouse && !assigned.has(node.spouse.member.id)) {
          node.spouse.generation = 0; assigned.add(node.spouse.member.id);
        }
      }
    }
  }

  // 排序子女
  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  // 按代分组
  const genMap = new Map<number, TreeNode[]>();
  for (const [, node] of nodeMap) {
    if (!assigned.has(node.member.id)) continue;
    if (!genMap.has(node.generation)) genMap.set(node.generation, []);
    genMap.get(node.generation)!.push(node);
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
      const isHusband = node.member.gender === "男" || (sn.member.gender === "女" && node.member.gender !== "女") || node.member.id < sn.member.id;
      groups.push({ husband: isHusband ? node : sn, wife: isHusband ? sn : node, children: node.children });
      used.add(node.member.id); used.add(sn.member.id);
    } else {
      groups.push({ husband: node, wife: null, children: node.children });
      used.add(node.member.id);
    }
  }
  return groups;
}

function getGenerationLabel(gen: number): string {
  const labels = ["第一代", "第二代", "第三代", "第四代", "第五代", "第六代", "第七代", "第八代", "第九代", "第十代"];
  return gen < labels.length ? labels[gen] : `${gen + 1}世`;
}

// ==================== 常量 ====================

const LINE_COLOR = "#4a2c17";
const LINE_WIDTH = 2;
const DOT_SIZE = 8;

// ==================== SVG连线元件 ====================

/** 夫妻分隔符：淡色竖线 */
function SpouseSeparator({ height = 40 }: { height?: number }) {
  return (
    <svg width="2" height={height} className="flex-shrink-0 mx-1" style={{ display: 'block' }}>
      <line x1="1" y1="2" x2="1" y2={height - 2} stroke={LINE_COLOR} strokeWidth={1} strokeOpacity={0.3} />
    </svg>
  );
}

function StoryBlock({ story }: { story: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!story) return null;
  const isLong = story.length > 100;
  return (
    <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
      <button className="w-full text-left" onClick={() => setExpanded(!expanded)}>
        <p className="text-xs font-bold text-[#8b0000]/70 mb-1">📖 我的故事 {isLong && (expanded ? "▲" : "▼")}</p>
        <p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">{isLong && !expanded ? story.slice(0, 100) + "…" : story}</p>
      </button>
    </div>
  );
}

// ==================== 成员卡片 ====================

function MemberCard({
  member, isSpouse = false, editable = false,
  onEdit, onEditStory, onAddParent, onAddChild, onAddSpouse, onRequestEdit, onUpdateMember,
}: {
  member: Member; isSpouse?: boolean; editable?: boolean;
  onEdit?: () => void; onEditStory?: () => void;
  onAddParent?: () => void; onAddChild?: () => void; onAddSpouse?: () => void;
  onRequestEdit?: () => void; onUpdateMember?: (m: Member) => void;
}) {
  const [show, setShow] = useState(false);
  const [menu, setMenu] = useState(false);
  const birthText = member.birth && member.death ? `${member.birth}—${member.death}`
    : member.birth ? `生于 ${member.birth}` : member.death ? `卒于 ${member.death}` : null;

  return (
    <div className="relative flex flex-col items-center">
      {editable && (
        <div className="relative mb-0.5">
          <button onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}
            className="w-5 h-5 rounded-full bg-[#8b0000] text-white text-[10px] font-bold shadow-md hover:bg-[#a52a2a] flex items-center justify-center">+</button>
          {menu && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-1.5 flex gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { onEdit?.(); setMenu(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8]">✏️ 编辑</button>
              <button onClick={() => { onAddParent?.(); setMenu(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8]">⬆️ 父辈</button>
              <button onClick={() => { onAddChild?.(); setMenu(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8]">⬇️ 子嗣</button>
              <button onClick={() => { onAddSpouse?.(); setMenu(false); }} className="px-2.5 py-1 rounded-lg text-xs text-[#5c3a2e] hover:bg-[#f5f0e8]">👩‍❤️‍👨 配偶</button>
            </div>
          )}
        </div>
      )}
      <button onClick={() => { if (editable) onEditStory?.(); else { onRequestEdit?.(); onEdit?.(); } }}
        className="text-xs mb-0.5 hover:scale-110 transition-transform" title={member.story ? "查看故事" : "写故事"}>
        {member.story ? "📖" : "✏️ 写故事"}
      </button>
      <div onClick={() => setShow(!show)}
        className={`px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-200 border-2 select-none min-w-[80px] text-center ${isSpouse ? "bg-rose-50/80 border-rose-300/50" : "bg-white border-[#d4a76a] hover:border-[#8b0000]"} hover:shadow-md`}>
        <div className={`font-bold tracking-wider ${isSpouse ? "text-rose-700 text-sm" : "text-[#8b0000] text-base"}`}>{member.name}</div>
        {birthText && <div className="text-[10px] text-[#5c3a2e]/50 mt-0.5 leading-tight">{birthText}</div>}
      </div>
      {show && (
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 text-sm text-[#5c3a2e]" onClick={(e) => e.stopPropagation()}>
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-[#d4a76a]/20 rotate-45" />
          <p className="font-bold text-[#8b0000] mb-1 text-base">{member.name}</p>
          {birthText && <p className="text-xs text-[#5c3a2e]/60 mb-2">{birthText}</p>}

          {/* 照片展示 / 上传引导 */}
          <div className="mb-3">
            {member.photoOriginal || member.photoRestored ? (
              <>
                <div className="relative w-full h-36 rounded-lg overflow-hidden bg-[#f5f0e8] border border-[#d4a76a]/20">
                  <img
                    src={getImageUrls(member.photoRestored || member.photoOriginal || "")[0]}
                    onError={createImgFallback(getImageUrls(member.photoRestored || member.photoOriginal || ""))}
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
                    const fd = new FormData();
                    fd.append('photo', file);
                    fd.append('memberId', member.id);
                    try {
                      const r = await fetch('/api/upload-photo', { method: 'POST', body: fd });
                      const d = await r.json();
                      if (d.cid) alert('照片上传成功！请保存修订以永久保存。');
                      else alert(d.error || '上传失败');
                    } catch {
                      alert('网络异常');
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

          {member.info && <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2"><p className="text-xs font-bold text-[#8b0000]/70 mb-1">📜 生平</p><p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">{member.info}</p></div>}
          {member.story && <StoryBlock story={member.story} />}
          <MemberMemories member={member} editable={editable} onUpdateMember={onUpdateMember} />
          <button className="w-full mt-1 text-xs text-[#c4a67a] hover:text-[#8b0000] py-1" onClick={() => setShow(false)}>关闭</button>
        </div>
      )}
    </div>
  );
}

// ==================== 编辑表单 ====================

interface EditFormData { name: string; birth: string; death: string; info: string; story: string; burialPlace: string; burialCoords: string; }

function MemberEditForm({
  initial, onSave, onCancel, title, storyFocus,
}: {
  initial: EditFormData; onSave: (d: EditFormData) => void; onCancel: () => void; title: string; storyFocus?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [birth, setBirth] = useState(initial.birth);
  const [death, setDeath] = useState(initial.death);
  const [info, setInfo] = useState(initial.info);
  const [story, setStory] = useState(initial.story);
  const [burialPlace, setBurialPlace] = useState(initial.burialPlace);
  const [burialCoords, setBurialCoords] = useState(initial.burialCoords);
  const storyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (storyFocus && storyRef.current) setTimeout(() => { storyRef.current?.focus(); }, 200); }, [storyFocus]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#8b0000] mb-4 tracking-wider">{title}</h3>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">姓名 *</label><input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="姓名" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">出生年份</label><input type="text" value={birth} onChange={e => setBirth(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">逝世年份</label><input type="text" value={death} onChange={e => setDeath(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">生平简介</label><textarea value={info} onChange={e => setInfo(e.target.value)} rows={3} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">📖 故事</label><textarea ref={storyRef} value={story} onChange={e => setStory(e.target.value)} rows={4} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">🪦 安葬地</label><input type="text" value={burialPlace} onChange={e => setBurialPlace(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：河北保定某陵园" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">安葬地坐标（可选）</label><input type="text" value={burialCoords} onChange={e => setBurialCoords(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="纬度,经度" /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => { if (!name.trim()) return; onSave({ name: name.trim(), birth, death, info, story: story.trim() || "", burialPlace: burialPlace.trim() || "", burialCoords: burialCoords.trim() || "" }); }}
            disabled={!name.trim()} className="flex-1 px-4 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] disabled:opacity-40">保存</button>
          <button onClick={onCancel} className="px-4 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8]">取消</button>
        </div>
      </div>
    </div>
  );
}

// ==================== 夫妻单元渲染 ====================

/** 用 SVG 绘制从夫妻到子女的连接线（竖线→分叉点→水平分支→每个子女的垂直线） */
function ChildrenConnection({ childrenCount, containerWidth }: { childrenCount: number; containerWidth: number }) {
  if (childrenCount === 0) return null;
  const vLineH = 20;      // 从夫妻到分叉点的竖线高度
  const dropH = 14;       // 从水平线到每个子女的垂直线高度
  const dotR = DOT_SIZE / 2;         // 分叉点圆点半径
  const svgH = vLineH + dotR + dropH; // SVG 总高度
  const cx = containerWidth / 2;     // 中心 x

  // 计算每个子女位置：均匀分布
  const childSpacing = childrenCount > 1 ? containerWidth / (childrenCount - 1) : 0;

  return (
    <svg width={containerWidth} height={svgH} style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
      {/* 从夫妻中心向下的竖线 */}
      <line x1={cx} y1="0" x2={cx} y2={vLineH} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} />
      {/* 分叉点 */}
      <circle cx={cx} cy={vLineH} r={dotR} fill={LINE_COLOR} />
      {childrenCount === 1 ? (
        /* 单个子女：直接向下 */
        <line x1={cx} y1={vLineH + dotR} x2={cx} y2={svgH} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} />
      ) : (
        <>
          {/* 水平分叉线 */}
          <line x1="0" y1={vLineH + dotR} x2={containerWidth} y2={vLineH + dotR} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} />
          {/* 每个子女的垂直线 */}
          {Array.from({ length: childrenCount }).map((_, i) => {
            const x = i === 0 ? 0 : i === childrenCount - 1 ? containerWidth : i * childSpacing;
            return <line key={i} x1={x} y1={vLineH + dotR} x2={x} y2={vLineH + dotR + dropH} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} />;
          })}
        </>
      )}
    </svg>
  );
}

function CoupleUnit({
  couple, editable, onEditMember, onEditStory, onAddParent, onAddChild, onAddSpouse, onRequestEdit, onUpdateMember,
}: {
  couple: CoupleGroup; editable: boolean;
  onEditMember: (m: Member) => void; onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void; onAddChild: (m: Member) => void; onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void; onUpdateMember?: (m: Member) => void;
}) {
  const { husband, wife, children } = couple;
  const childCount = children.length;
  const childrenRef = useRef<HTMLDivElement>(null);
  const [forkWidth, setForkWidth] = useState(0);

  // 测量子女容器宽度，动态计算分叉 SVG 宽度
  useEffect(() => {
    const el = childrenRef.current;
    if (!el || childCount === 0) { setForkWidth(0); return; }
    const measure = () => {
      let totalW = 0;
      for (const child of el.children) {
        totalW += (child as HTMLElement).offsetWidth;
      }
      // 加上子元素之间的间隔 (gap)
      const gap = parseFloat(getComputedStyle(el).gap || '0') * (childCount - 1);
      setForkWidth(Math.max(totalW + gap, 60));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [childCount]);

  return (
    <div className="flex flex-col items-center">
      {/* 夫妻行：紧密并排，中间仅用淡色竖线分隔（修复问题4） */}
      <div className="flex items-center">
        {husband && (
          <MemberCard
            member={husband.member}
            isSpouse={false}
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
        {/* 夫妻分隔符：淡色竖线代替原来的"配"字+横线 */}
        {husband && wife && <SpouseSeparator height={40} />}
        {wife && (
          <MemberCard
            member={wife.member}
            isSpouse={true}
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

      {/* 向下的连线：竖线分叉连到每个子女（修复问题3） */}
      {childCount > 0 && (
        <div className="flex flex-col items-center">
          {/* 从夫妻中间引出的竖线 → 分叉点 → 水平分支 → 每个子女垂直线 */}
          {/* 用 SVG 统一绘制所有连接线，基于子女容器宽度动态计算 */}
          <ChildrenConnection childrenCount={childCount} containerWidth={Math.max(forkWidth, 60)} />

          {/* 子女排列（平铺，彼此之间不画横线，修复问题1） */}
          <div ref={childrenRef} className="flex items-start gap-0" style={{ marginTop: -1 }}>
            {children.map((child) => (
              <div key={child.member.id} className="flex flex-col items-center">
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 宝塔式一代的渲染 ====================

function PagodaGeneration({
  generation, editable, onEditMember, onEditStory, onAddParent, onAddChild, onAddSpouse, onRequestEdit, onUpdateMember,
}: {
  generation: GenerationRow; editable: boolean;
  onEditMember: (m: Member) => void; onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void; onAddChild: (m: Member) => void; onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void; onUpdateMember?: (m: Member) => void;
}) {
  const couples = generation.couples;
  return (
    <div className="flex flex-col items-center">
      {/* 代际标签 */}
      <div className="text-xs text-[#8b0000]/50 font-bold mb-2 tracking-wider">{getGenerationLabel(generation.generation)}</div>

      {/* 夫妻组水平排列 */}
      <div className="flex items-start gap-8">
        {couples.map((cpl, idx) => (
          <CoupleUnit
            key={cpl.husband?.member.id ?? cpl.wife?.member.id ?? idx}
            couple={cpl}
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

// ==================== 主导出组件 ====================

export function PagodaTreeView({
  tree, editable = false, onTreeChange, onRequestEdit,
}: {
  tree: FamilyTree; editable?: boolean; onTreeChange?: (t: FamilyTree) => void; onRequestEdit?: () => void;
}) {
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingStoryMember, setEditingStoryMember] = useState<Member | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const members = tree.members || [];
  const generations = useMemo(() => buildPagodaTree(members), [members]);

  const handleEditMember = useCallback((m: Member) => setEditingMember(m), []);
  const handleEditStory = useCallback((m: Member) => setEditingStoryMember(m), []);

  const handleAddParent = useCallback((m: Member) => {
    if (!onTreeChange) return;
    const newMember: Member = { id: generateId(), name: "新父辈", gender: "男", childrenIds: [m.id] };
    onTreeChange({ ...tree, members: [...tree.members, newMember] });
  }, [tree, onTreeChange]);

  const handleAddChild = useCallback((m: Member) => {
    if (!onTreeChange) return;
    const spouse = members.find(x => x.spouseId === m.id || x.spouseOf === m.id);
    const newMember: Member = { id: generateId(), name: "新子嗣", gender: "男", parentId: m.id, fatherId: spouse ? undefined : m.id, motherId: spouse ? m.id : undefined };
    onTreeChange({ ...tree, members: [...tree.members, newMember] });
  }, [tree, members, onTreeChange]);

  const handleAddSpouse = useCallback((m: Member) => {
    if (!onTreeChange) return;
    const newMember: Member = { id: generateId(), name: "配偶", gender: "女", spouseId: m.id, spouseOf: m.id };
    onTreeChange({ ...tree, members: [...tree.members, newMember] });
  }, [tree, onTreeChange]);

  const handleUpdateMember = useCallback((updated: Member) => {
    if (!onTreeChange) return;
    onTreeChange({ ...tree, members: tree.members.map(m => m.id === updated.id ? updated : m) });
  }, [tree, onTreeChange]);

  const handleSaveEdit = useCallback((data: EditFormData) => {
    if (editingMember && onTreeChange) {
      handleUpdateMember({ ...editingMember, name: data.name, birth: data.birth, death: data.death, info: data.info, story: data.story || editingMember.story || "", burialPlace: data.burialPlace, burialCoords: data.burialCoords });
      setEditingMember(null);
    }
  }, [editingMember, onTreeChange, handleUpdateMember]);

  const handleSaveStory = useCallback((data: EditFormData) => {
    if (editingStoryMember && onTreeChange) {
      handleUpdateMember({ ...editingStoryMember, story: data.story });
      setEditingStoryMember(null);
    }
  }, [editingStoryMember, onTreeChange, handleUpdateMember]);

  const debugInfo = useMemo(() => {
    const lines: string[] = [];
    for (const gen of generations) {
      lines.push(`\n${getGenerationLabel(gen.generation)}:`);
      for (const c of gen.couples) {
        const h = c.husband?.member.name || "?"; const w = c.wife?.member.name || "";
        const kids = c.children.map(x => x.member.name).join(", ");
        lines.push(`  ${h}${w ? " 配 " + w : ""}${kids ? " → " + kids : ""}`);
      }
    }
    return lines.join("\n");
  }, [generations]);

  // ==================== 调试面板 ====================

  return (
    <div className="relative py-8 px-4 overflow-x-auto">
      {/* version: 20260615-fix-bfs-root-node */}
      {/* 调试按钮 */}
      {process.env.NODE_ENV === "development" && (
        <div className="fixed top-4 left-4 z-30">
          <button
            onClick={() => setDebugOpen(!debugOpen)}
            className="px-2 py-1 text-xs bg-[#f5f0e8] border border-[#d4a76a]/30 rounded"
          >
            🐛 {debugOpen ? "关闭调试" : "调试"}
          </button>
        </div>
      )}

      {/* 调试面板 */}
      {debugOpen && (
        <div className="fixed top-12 left-4 z-30 bg-white/95 border border-[#d4a76a]/20 rounded-xl shadow-xl p-4 max-w-xs max-h-80 overflow-auto text-xs text-[#5c3a2e] font-mono">
          <p className="font-bold text-[#8b0000] mb-1">📊 树结构</p>
          <pre>{debugInfo}</pre>
        </div>
      )}

      {/* 代际列表 */}
      {generations.length > 0 ? (
        <div className="flex flex-col items-center gap-16">
          {generations.map((gen) => (
            <PagodaGeneration
              key={gen.generation}
              generation={gen}
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
      ) : (
        <div className="text-center py-12 text-[#c4a67a] text-sm">
          {editable ? "点击下面按钮开始创建家族树" : "暂无数据"}
        </div>
      )}

      {/* 底部占位 */}
      <div className="h-16" />

      {/* 编辑弹窗 */}
      {editingMember && (
        <MemberEditForm
          title={`编辑 ${editingMember.name || ""}`}
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

      {/* 故事编辑弹窗 */}
      {editingStoryMember && (
        <MemberEditForm
          title={`📖 编辑 ${editingStoryMember.name || ""} 的故事`}
          initial={{
            name: editingStoryMember.name || "",
            birth: editingStoryMember.birth || "",
            death: editingStoryMember.death || "",
            info: editingStoryMember.info || "",
            story: editingStoryMember.story || "",
            burialPlace: editingStoryMember.burialPlace || "",
            burialCoords: editingStoryMember.burialCoords || "",
          }}
          onSave={handleSaveStory}
          onCancel={() => setEditingStoryMember(null)}
          storyFocus
        />
      )}
    </div>
  );
}
