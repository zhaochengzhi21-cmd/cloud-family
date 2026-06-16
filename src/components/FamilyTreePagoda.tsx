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
      const spouseId = m.spouseOf || m.spouseId;
      let spouseHasParent = false;
      if (spouseId) {
        const spouse = members.find(x => x.id === spouseId);
        if (spouse) {
          spouseHasParent = !!(spouse.fatherId && spouse.fatherId !== "") || !!(spouse.motherId && spouse.motherId !== "");
        }
      }
      if (!spouseHasParent) gen0Ids.push(m.id);
    }
  }
  if (gen0Ids.length === 0) {
    const isChild = new Set<string>();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  const queue: { nodeId: string; gen: number }[] = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

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

    const allChildIds = new Set<string>();
    for (const cid of getChildIds(node.member, members)) allChildIds.add(cid);
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) allChildIds.add(cid);
    }

    for (const cid of allChildIds) {
      const cn = nodeMap.get(cid);
      if (cn && !assigned.has(cid)) {
        if (!node.children.some(c => c.member.id === cid)) {
          node.children.push(cn);
        }
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

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

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

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

// ==================== 夫妻分隔竖线（淡色细竖线，不加"配"字）====================

function SpouseSeparator() {
  return (
    <div className="flex-shrink-0 mx-1 flex items-center justify-center" style={{ width: 12, height: 50 }}>
      <div style={{ width: 1.5, height: "70%", backgroundColor: "#d4a76a", opacity: 0.4 }} />
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
    <div className="relative flex flex-col items-center" data-member-id={member.id}>
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

function CoupleUnit({
  couple, editable, onEditMember, onEditStory, onAddParent, onAddChild, onAddSpouse, onRequestEdit, onUpdateMember,
}: {
  couple: CoupleGroup; editable: boolean;
  onEditMember: (m: Member) => void; onEditStory: (m: Member) => void;
  onAddParent: (m: Member) => void; onAddChild: (m: Member) => void; onAddSpouse: (m: Member) => void;
  onRequestEdit?: () => void; onUpdateMember?: (m: Member) => void;
}) {
  const { husband, wife } = couple;

  return (
    <div className="flex items-center" data-couple-root="true">
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
      {husband && wife && <SpouseSeparator />}
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
      <div className="text-xs text-[#8b0000]/50 font-bold mb-2 tracking-wider">{getGenerationLabel(generation.generation)}</div>
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

// ==================== 连线绘制组件 ====================

/**
 * 在相邻两代之间绘制垂直连线。
 * 连线规则：
 * - 从每个夫妻组正下方中间引出竖直向下的线
 * - 在到达子女层前分叉（分叉处有实心圆点），再分别连接到每个子女的头顶正中间
 * - 无配偶的，从单人卡片正下方引出
 * - 所有线条 2px 深棕色 #4a2c17 实线
 */
function GenerationLines({ generations, containerRef }: {
  generations: GenerationRow[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [paths, setPaths] = useState<{ d: string; dots: { cx: number; cy: number }[] }[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [key, setKey] = useState(0);

  // 监听布局变化重新计算
  useEffect(() => {
    const container = containerRef.current;
    if (!container || generations.length === 0) return;

    let rafId: number;
    let timer: ReturnType<typeof setTimeout>;

    const calc = () => {
      const cr = container.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) return;
      setSvgSize({ w: cr.width, h: cr.height });

      const result: { d: string; dots: { cx: number; cy: number }[] }[] = [];

      // 建立 memberId -> 其所属 couple 在 generations 中的索引的映射
      // 用于查找子女所属的父代夫妻组
      const coupleMap = new Map<string, { genIdx: number; coupleIdx: number; couple: CoupleGroup }>();
      for (let gi = 0; gi < generations.length; gi++) {
        const gen = generations[gi];
        for (let ci = 0; ci < gen.couples.length; ci++) {
          const cpl = gen.couples[ci];
          if (cpl.husband) coupleMap.set(cpl.husband.member.id, { genIdx: gi, coupleIdx: ci, couple: cpl });
          if (cpl.wife) coupleMap.set(cpl.wife.member.id, { genIdx: gi, coupleIdx: ci, couple: cpl });
        }
      }

      // 对于每对相邻代际，遍历所有父代夫妻组
      for (let gi = 0; gi < generations.length - 1; gi++) {
        const parentGen = generations[gi];
        const childGen = generations[gi + 1];

        for (const parentCouple of parentGen.couples) {
          const children = parentCouple.children;
          if (children.length === 0) continue;

          // 找父代 DOM 元素
          const parentIds: string[] = [];
          if (parentCouple.husband) parentIds.push(parentCouple.husband.member.id);
          if (parentCouple.wife) parentIds.push(parentCouple.wife.member.id);

          let parentEl: HTMLElement | null = null;
          // 尝试通过 data-couple-ids 属性找到当前夫妻组的容器
          for (const pid of parentIds) {
            parentEl = container.querySelector<HTMLElement>(`[data-member-id="${pid}"]`);
            if (parentEl) {
              // 找到最近的有 data-couple-root 的祖先
              const coupleRoot = parentEl.closest<HTMLElement>("[data-couple-root]");
              if (coupleRoot) { parentEl = coupleRoot; break; }
            }
          }
          if (!parentEl) continue;
          const pRect = parentEl.getBoundingClientRect();
          const px = pRect.left + pRect.width / 2 - cr.left;
          const py = pRect.bottom - cr.top;

          // 找每个子女的 DOM 元素
          const childEls: HTMLElement[] = [];
          for (const child of children) {
            const el = container.querySelector<HTMLElement>(`[data-member-id="${child.member.id}"]`);
            if (el) childEls.push(el);
          }
          if (childEls.length === 0) continue;

          const childPoints = childEls.map(el => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2 - cr.left, y: r.top - cr.top };
          }).sort((a, b) => a.x - b.x);

          const startY = py;
          const midX = px;
          // 分叉处 y 坐标：子女头顶上方 20px
          const forkY = Math.max(childPoints[0].y - 20, startY + 20);
          const dots: { cx: number; cy: number }[] = [];
          let d = "";

          if (childPoints.length === 1) {
            // 单子女：直接从父母中间向下连到子女头顶
            d = `M ${midX} ${startY} L ${midX} ${childPoints[0].y}`;
          } else {
            // 多子女：竖线到分叉点，然后分叉到每个子女
            const leftX = childPoints[0].x;
            const rightX = childPoints[childPoints.length - 1].x;
            d = `M ${midX} ${startY} L ${midX} ${forkY}`;
            // 分叉水平线
            const leftmost = Math.min(leftX, midX - 20);
            const rightmost = Math.max(rightX, midX + 20);
            d += ` L ${leftmost} ${forkY}`;
            d += ` M ${rightmost} ${forkY} L ${midX} ${forkY}`;
            // 从分叉线两端向下到每个子女的头顶
            for (const cp of childPoints) {
              d += ` M ${cp.x} ${forkY} L ${cp.x} ${cp.y}`;
            }
            // 实心圆点：分叉处（左端点和右端点之间的中点? 在 midX 处）
            dots.push({ cx: midX, cy: forkY });
          }

          result.push({ d, dots });
        }
      }

      setPaths(result);
      setKey(k => k + 1);
    };

    // 初始计算 + resize 监听
    const doCalc = () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(calc); };
    timer = setTimeout(doCalc, 100);
    window.addEventListener("resize", doCalc);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      window.removeEventListener("resize", doCalc);
    };
  }, [generations, containerRef]);

  return (
    <svg
      key={key}
      className="absolute top-0 left-0 pointer-events-none z-10"
      width={svgSize.w}
      height={svgSize.h}
      style={{ overflow: "visible" }}
    >
      {paths.map((p, i) => (
        <g key={i}>
          <path d={p.d} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} fill="none" />
          {p.dots.map((dot, j) => (
            <circle key={j} cx={dot.cx} cy={dot.cy} r={4} fill={LINE_COLOR} />
          ))}
        </g>
      ))}
    </svg>
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
  const treeContainerRef = useRef<HTMLDivElement>(null);

  const members = tree.members || [];
  const generations = useMemo(() => buildPagodaTree(members), [members]);

  const handleEditMember = useCallback((m: Member) => {
    if (!editable) return;
    setEditingMember(m);
  }, [editable]);

  const handleEditStory = useCallback((m: Member) => {
    if (!editable) return;
    setEditingStoryMember(m);
  }, [editable]);

  const handleAddParent = useCallback((m: Member) => {
    const newMember: Member = {
      id: generateId(),
      name: "新成员",
      gender: "女",
      childrenIds: [m.id],
    };
    const newTree: FamilyTree = { ...tree, members: [...members, newMember] };
    onTreeChange?.(newTree);
  }, [members, tree, onTreeChange]);

  const handleAddChild = useCallback((m: Member) => {
    const newMember: Member = {
      id: generateId(),
      name: "新成员",
      gender: "男",
      parentId: m.id,
      fatherId: m.gender === "男" ? m.id : undefined,
      motherId: m.gender === "女" ? m.id : undefined,
    };
    const newTree: FamilyTree = { ...tree, members: [...members, newMember] };
    onTreeChange?.(newTree);
  }, [members, tree, onTreeChange]);

  const handleAddSpouse = useCallback((m: Member) => {
    const spouseGender = m.gender === "男" ? "女" : "男";
    const newMember: Member = {
      id: generateId(),
      name: "新配偶",
      gender: spouseGender,
      spouseOf: m.id,
      spouseId: m.id,
    };
    const newTree: FamilyTree = { ...tree, members: [...members, newMember] };
    onTreeChange?.(newTree);
  }, [members, tree, onTreeChange]);

  const handleSaveEdit = useCallback((data: EditFormData) => {
    if (!editingMember) return;
    const updated = members.map(m => {
      if (m.id === editingMember.id) {
        return {
          ...m,
          name: data.name,
          birth: data.birth || undefined,
          death: data.death || undefined,
          info: data.info || undefined,
          story: data.story || undefined,
          burialPlace: data.burialPlace || undefined,
          burialCoords: data.burialCoords || undefined,
        } as Member;
      }
      return m;
    });
    const newTree: FamilyTree = { ...tree, members: updated };
    onTreeChange?.(newTree);
    setEditingMember(null);
  }, [editingMember, members, tree, onTreeChange]);

  const handleSaveStory = useCallback((data: EditFormData) => {
    if (!editingStoryMember) return;
    const updated = members.map(m => {
      if (m.id === editingStoryMember.id) {
        return { ...m, story: data.story || undefined } as Member;
      }
      return m;
    });
    const newTree: FamilyTree = { ...tree, members: updated };
    onTreeChange?.(newTree);
    setEditingStoryMember(null);
  }, [editingStoryMember, members, tree, onTreeChange]);

  const handleUpdateMember = useCallback((updatedMember: Member) => {
    const updated = members.map(m => m.id === updatedMember.id ? updatedMember : m);
    const newTree: FamilyTree = { ...tree, members: updated };
    onTreeChange?.(newTree);
  }, [members, tree, onTreeChange]);

  return (
    <div className="relative bg-white rounded-xl p-4 sm:p-8 shadow-lg border border-[#d4a76a]/20">
      {/* 树容器：使用 overflow-visible 让连线可以超出 */}
      <div ref={treeContainerRef} className="relative overflow-visible">
        {/* SVG 连线层：绝对定位覆盖整个容器 */}
        <GenerationLines generations={generations} containerRef={treeContainerRef} />

        {/* 代际节点 */}
        <div className="flex flex-col items-center gap-6 sm:gap-8 py-2">
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
      </div>

      {/* 编辑表单 */}
      {editable && editingMember && (
        <MemberEditForm
          title="✏️ 编辑成员信息"
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

      {editable && editingStoryMember && (
        <MemberEditForm
          title="📖 撰写故事"
          storyFocus
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
        />
      )}
    </div>
  );
}

