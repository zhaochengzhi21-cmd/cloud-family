"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  const gen0Ids: string[] = [];
  for (const m of members) {
    if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
      gen0Ids.push(m.id);
    }
  }
  if (gen0Ids.length === 0) {
    const isChild = new Set<string>();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  const queue: { nodeId: string; gen: number }[] = [];
  for (const id of gen0Ids) if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift()!;
    if (assigned.has(nodeId) || gen > MAX_GENERATION) continue;
    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    node.generation = gen;
    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }
    for (const cid of getChildIds(node.member, members)) {
      const cn = nodeMap.get(cid);
      if (cn && !assigned.has(cid)) { node.children.push(cn); queue.push({ nodeId: cid, gen: gen + 1 }); }
    }
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) {
        const cn = nodeMap.get(cid);
        if (cn && !assigned.has(cid) && !node.children.some(c => c.member.id === cid)) {
          node.children.push(cn); queue.push({ nodeId: cid, gen: gen + 1 });
        }
      }
    }
  }

  // 处理孤立节点
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
  for (const [, node] of nodeMap) node.children.sort((a, b) => sortByBirth(a.member, b.member));

  // 分组
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

function SpouseBar({ width = 40 }: { width?: number }) {
  return (
    <svg width={width} height={24} className="flex-shrink-0" style={{ display: 'block' }}>
      <line x1="0" y1="12" x2={width} y2="12" stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} />
      <text x={width / 2} y={16} textAnchor="middle" fill={LINE_COLOR} fontSize="11" fontWeight="bold">配</text>
    </svg>
  );
}

function VLine({ height = 24 }: { height?: number }) {
  return <svg width="2" height={height} style={{ display: 'block', flexShrink: 0 }}><line x1="1" y1="0" x2="1" y2={height} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} /></svg>;
}

function Dot({ size = DOT_SIZE }: { size?: number }) {
  return <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }}><circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={LINE_COLOR} /></svg>;
}

function HLine({ width = 16, thin = false }: { width?: number; thin?: boolean }) {
  return <svg width={width} height="2" style={{ display: 'block', flexShrink: 0 }}><line x1="0" y1="1" x2={width} y2="1" stroke={LINE_COLOR} strokeWidth={thin ? 1 : LINE_WIDTH} strokeOpacity={thin ? 0.4 : 1} /></svg>;
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
        <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 text-sm text-[#5c3a2e]" onClick={(e) => e.stopPropagation()}>
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-[#d4a76a]/20 rotate-45" />
          <p className="font-bold text-[#8b0000] mb-1 text-base">{member.name}</p>
          {birthText && <p className="text-xs text-[#5c3a2e]/60 mb-2">{birthText}</p>}
          {member.info && <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2"><p className="text-xs font-bold text-[#8b0000]/70 mb-1">📜 生平</p><p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap">{member.info}</p></div>}
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
      {/* 代际标签（只在第一行显示） */}
      <div className="text-xs text-[#8b0000]/50 font-bold mb-2 tracking-wider">{getGenerationLabel(generation.generation)}</div>

      {/* 夫妻组水平排列 */}
      <div className="flex items-start gap-8">
        {couples.map((cpl, idx) => (
          <CoupleUnit
            key={idx}
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

// ==================== 夫妻单元渲染 ====================

function CoupleUnit({
  couple, editable, onEditMember, onEditStory, onAddParent, onAddChild, onAddSpouse, onRequestEdit, onUpdateMember,
}: {
  couple: CoupleGroup; editable: boolean;
  onEditMember: (m: Member) => void; onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void; onAddChild: (m: Member) => void; onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void; onUpdateMember?: (m: Member) => void;
}) {
  const { husband, wife, children } = couple;

  // 计算中间引线位置：有配偶时从两人中间，无配偶时从单人正下方
  const hasSpouse = husband && wife;
  // 子女数量
  const childCount = children.length;

  return (
    <div className="flex flex-col items-center">
      {/* 夫妻行 */}
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
        {hasSpouse && <SpouseBar width={36} />}
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

      {/* 向下的连线 */}
      {childCount > 0 && (
        <div className="flex flex-col items-center">
          {/* 从夫妻/单人中间引出的竖线 */}
          <VLine height={20} />
          {/* 圆点分叉 */}
          <div className="flex items-center">
            <Dot />
            {childCount > 1 && (
              <HLine width={Math.max(16, (childCount - 1) * 14)} />
            )}
          </div>
          {/* 子女行 */}
          <div className="flex items-center mt-0">
            {children.map((child, cidx) => (
              <div key={child.member.id} className="flex items-center">
                {cidx > 0 && <HLine width={14} />}
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

  if (members.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🌳</div>
        <p className="text-xl font-bold text-[#8b0000] mb-2">家族树已建立</p>
        <p className="text-sm text-[#c4a67a]">暂无成员数据</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-[#8b0000] tracking-wider">🌳 家族世系图</h2>
        <p className="text-xs text-[#c4a67a] mt-1">共 {generations.length} 代 · {members.length} 位族人</p>
      </div>

      {/* 宝塔式世系图 */}
      <div className="py-6 overflow-x-auto">
        <div className="flex flex-col items-center gap-0 min-w-max">
          {generations.map((gen, i) => (
            <div key={i} className="flex flex-col items-center">
              {/* 代际连接线（非第一代时，从上一代到本代）*/}
              <PagodaGeneration
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
              {/* 代间连线（非最后一代） */}
              {i < generations.length - 1 && (
                <div className="flex flex-col items-center py-2">
                  <VLine height={20} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 编辑弹窗 */}
      {editingMember && (
        <MemberEditForm
          initial={{
            name: editingMember.name,
            birth: editingMember.birth || "",
            death: editingMember.death || "",
            info: editingMember.info || "",
            story: editingMember.story || "",
            burialPlace: editingMember.burialPlace || "",
            burialCoords: editingMember.burialCoords || "",
          }}
          onSave={handleSaveEdit}
          onCancel={() => setEditingMember(null)}
          title={`编辑 - ${editingMember.name}`}
        />
      )}

      {editingStoryMember && (
        <MemberEditForm
          initial={{ name: editingStoryMember.name, birth: "", death: "", info: "", story: editingStoryMember.story || "", burialPlace: "", burialCoords: "" }}
          onSave={handleSaveStory}
          onCancel={() => setEditingStoryMember(null)}
          title={`📖 写下${editingStoryMember.name}的故事`}
          storyFocus={true}
        />
      )}

      {/* 调试 */}
      <div className="fixed bottom-4 right-4 z-50">
        <button onClick={() => setDebugOpen(!debugOpen)}
          className="px-3 py-1.5 bg-[#8b0000] text-white rounded-lg text-xs font-bold hover:bg-[#a52a2a]">
          {debugOpen ? "关闭调试" : "🔧 调试"}
        </button>
        {debugOpen && (
          <div className="mt-2 bg-white rounded-xl shadow-xl border border-[#d4a76a]/20 p-4 max-w-md max-h-80 overflow-auto">
            <pre className="text-xs text-[#5c3a2e] whitespace-pre-wrap">{debugInfo}</pre>
          </div>
        )}
      </div>
    </div>
  );
}