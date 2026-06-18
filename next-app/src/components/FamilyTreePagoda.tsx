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

interface EditFormData {
  name: string;
  gender: string;
  birth: string;
  death: string;
  generationWord: string;
  info: string;
  story: string;
  burialPlace: string;
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
const CARD_H_GAP = 32;
const GENERATION_V_GAP = 72;

// ==================== 夫妻分隔竖线 ====================

function SpouseSeparator() {
  return (
    <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 16, height: 60 }}>
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

  // 根据 gender 决定卡片背景色：女性粉色，男性白色
  const cardBg = member.gender === "女" ? "bg-rose-50/90" : "bg-white";
  const cardBorder = member.gender === "女" ? "border-rose-300/50" : "border-[#d4a76a]";

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
        className={`px-3 py-3 rounded-lg cursor-pointer transition-all duration-200 border-2 select-none min-w-[90px] text-center shadow-sm ${cardBg} ${cardBorder} hover:shadow-md`}
        style={{ borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        {/* 头像/照片引导区域 */}
        <div className="flex justify-center mb-1.5">
          {member.photoOriginal || member.photoRestored ? (
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[#d4a76a]/30 bg-[#f5f0e8] flex-shrink-0">
              <img
                src={getImageUrls(member.photoRestored || member.photoOriginal || "")[0]}
                onError={createImgFallback(getImageUrls(member.photoRestored || member.photoOriginal || ""))}
                alt={member.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : editable ? (
            <div
              className="w-10 h-10 rounded-full border-2 border-dashed border-[#d4a76a]/40 bg-[#fdfbf7] flex items-center justify-center cursor-pointer hover:border-[#8b0000]/50 hover:bg-[#f5f0e8] transition-all flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async (ev) => {
                  const file = (ev.target as HTMLInputElement).files?.[0];
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
              title="点击上传照片"
            >
              <span className="text-sm">📷</span>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full border-2 border-[#d4a76a]/10 bg-[#fdfbf7] flex items-center justify-center flex-shrink-0">
              <span className="text-xs text-[#c4a67a]/60">👤</span>
            </div>
          )}
        </div>
        <div className={`font-bold tracking-wider ${isSpouse ? "text-rose-700 text-sm" : "text-[#8b0000] text-base"}`}>{member.name}</div>
        {birthText && <div className="text-[11px] text-[#8b7355]/60 mt-0.5 leading-tight">{birthText}</div>}
      </div>
      {/* ====== 详情弹窗 ====== */}
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

          {/* 安葬地：只在有逝世年份时显示 */}
          {member.burialPlace && member.death && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">🪦 安葬地</p>
              <p className="text-xs text-[#5c3a2e]/80">{member.burialPlace}</p>
              <a
                href={`https://uri.amap.com/search?keyword=${encodeURIComponent(member.burialPlace)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#8b0000]/70 hover:text-[#8b0000] underline mt-0.5 inline-block"
              >
                📍 在地图上查看
              </a>
            </div>
          )}

          {member.generationWord && (
            <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2">
              <p className="text-xs font-bold text-[#8b0000]/70 mb-1">📜 字辈</p>
              <p className="text-xs text-[#5c3a2e]/80">{member.generationWord}</p>
            </div>
          )}
          {member.info && <div className="bg-[#fdfbf7] rounded-lg p-3 border border-[#d4a76a]/10 mb-2"><p className="text-xs font-bold text-[#8b0000]/70 mb-1">📖 人生故事</p><p className="text-xs text-[#5c3a2e]/80 whitespace-pre-wrap leading-relaxed">{member.info}</p></div>}
          {member.story && <StoryBlock story={member.story} />}
          <MemberMemories member={member} editable={editable} onUpdateMember={onUpdateMember} />
          <button className="w-full mt-1 text-xs text-[#c4a67a] hover:text-[#8b0000] py-1" onClick={() => setShow(false)}>关闭</button>
        </div>
      )}
    </div>
  );
}

// ==================== 编辑表单 ====================

function MemberEditForm({
  initial, onSave, onCancel, title, storyFocus,
}: {
  initial: EditFormData; onSave: (d: EditFormData) => void; onCancel: () => void; title: string; storyFocus?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [gender, setGender] = useState(initial.gender);
  const [birth, setBirth] = useState(initial.birth);
  const [death, setDeath] = useState(initial.death);
  const [generationWord, setGenerationWord] = useState(initial.generationWord);
  const [info, setInfo] = useState(initial.info);
  const [story, setStory] = useState(initial.story);
  const [burialPlace, setBurialPlace] = useState(initial.burialPlace);
  const storyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (storyFocus && storyRef.current) setTimeout(() => { storyRef.current?.focus(); }, 200); }, [storyFocus]);

  const hasDeath = death.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#8b0000] mb-4 tracking-wider">{title}</h3>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">姓名 *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="姓名" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#5c3a2e] mb-1">性别</label>
            <select value={gender} onChange={e => setGender(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]">
              <option value="">请选择</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">出生年份</label><input type="text" value={birth} onChange={e => setBirth(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：1962" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">逝世年份</label><input type="text" value={death} onChange={e => setDeath(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：2023" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">字辈</label><input type="text" value={generationWord} onChange={e => setGenerationWord(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：文、武、成、康" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">📖 人生故事</label><textarea value={info} onChange={e => setInfo(e.target.value)} rows={3} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" placeholder="简述这位成员的人生经历……" /></div>
          <div><label className="block text-xs font-bold text-[#5c3a2e] mb-1">📖 故事</label><textarea ref={storyRef} value={story} onChange={e => setStory(e.target.value)} rows={4} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7] resize-none" placeholder="详细记录一段家族故事……" /></div>
          {/* 安葬地：只在有逝世年份时显示 */}
          {hasDeath && (
            <div>
              <label className="block text-xs font-bold text-[#5c3a2e] mb-1">🪦 安葬地</label>
              <input type="text" value={burialPlace} onChange={e => setBurialPlace(e.target.value)} className="w-full px-3 py-2 border border-[#d4a76a]/40 rounded-lg text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]" placeholder="如：山西省太原市清徐县XX村" />
              {hasDeath && (
                <p className="text-[10px] text-[#c4a67a] mt-1">填写后，详情中可点击「📍 在地图上查看」跳转高德地图</p>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => {
            if (!name.trim()) return;
            onSave({
              name: name.trim(),
              gender,
              birth,
              death,
              generationWord: generationWord.trim() || "",
              info: info.trim() || "",
              story: story.trim() || "",
              burialPlace: hasDeath ? burialPlace.trim() || "" : "",
            });
          }}
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
    <div className="relative flex flex-col items-center">
      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-4 whitespace-nowrap">
        <span className="text-xs text-[#8b0000]/50 font-bold tracking-wider">{getGenerationLabel(generation.generation)}</span>
      </div>
      <div className="flex items-start" style={{ gap: CARD_H_GAP }}>
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
      const coupleMap = new Map<string, { genIdx: number; coupleIdx: number; couple: CoupleGroup }>();
      for (let gi = 0; gi < generations.length; gi++) {
        const gen = generations[gi];
        for (let ci = 0; ci < gen.couples.length; ci++) {
          const cpl = gen.couples[ci];
          if (cpl.husband) coupleMap.set(cpl.husband.member.id, { genIdx: gi, coupleIdx: ci, couple: cpl });
          if (cpl.wife) coupleMap.set(cpl.wife.member.id, { genIdx: gi, coupleIdx: ci, couple: cpl });
        }
      }

      // 对每一代之间，计算连线
      for (let gi = 0; gi < generations.length - 1; gi++) {
        const curGen = generations[gi];
        const nextGen = generations[gi + 1];

        // 获取当前代所有 couples 的底部中心位置
        for (let ci = 0; ci < curGen.couples.length; ci++) {
          const cpl = curGen.couples[ci];
          const coupleEl = container.querySelector(
            `[data-couple-root]:nth-child(${ci + 1})`
          );
          if (!coupleEl) continue;

          // 获取当前 couple 的底部中心
          const coupleRect = coupleEl.getBoundingClientRect();
          const startX = coupleRect.left + coupleRect.width / 2 - cr.left;
          const startY = coupleRect.bottom - cr.top;

          // 找到此 couple 的子女
          if (cpl.children.length === 0) continue;

          // 获取每个子女卡片元素的顶部中心
          const childPositions: { x: number; y: number }[] = [];
          for (const child of cpl.children) {
            const childEl = container.querySelector(
              `[data-member-id="${child.member.id}"]`
            );
            if (!childEl) continue;
            const childCard = childEl.querySelector('[data-couple-root]') || childEl;
            const childRect = childCard.getBoundingClientRect();
            childPositions.push({
              x: childRect.left + childRect.width / 2 - cr.left,
              y: childRect.top - cr.top,
            });
          }

          if (childPositions.length === 0) continue;

          // 计算分叉点 Y: 子女和当前代之间垂直距离的中间偏下1/3处
          const minChildY = Math.min(...childPositions.map(p => p.y));
          const forkY = startY + (minChildY - startY) * 0.6;

          // 构建连线路径
          let pathD = "";
          pathD += `M ${startX} ${startY} `;
          pathD += `L ${startX} ${forkY} `;

          if (childPositions.length === 1) {
            pathD += `L ${childPositions[0].x} ${forkY} `;
            pathD += `L ${childPositions[0].x} ${childPositions[0].y}`;
          } else {
            // 分叉：水平线
            const minChildX = Math.min(...childPositions.map(p => p.x));
            const maxChildX = Math.max(...childPositions.map(p => p.x));
            pathD += `L ${minChildX} ${forkY} `;
            pathD += `L ${maxChildX} ${forkY} `;

            // 向下的竖线到每个子女
            for (const pos of childPositions) {
              pathD += `M ${pos.x} ${forkY} L ${pos.x} ${pos.y} `;
            }
          }

          // 收集分叉点上的实心圆点
          const dots = childPositions.map(pos => ({ cx: pos.x, cy: forkY }));

          result.push({ d: pathD, dots });
        }
      }

      setPaths(result);
    };

    // 初始计算
    rafId = requestAnimationFrame(() => {
      calc();
    });

    // 监听 resize
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        rafId = requestAnimationFrame(calc);
      }, 150);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      resizeObserver.disconnect();
    };
  }, [generations, containerRef]);

  if (svgSize.w === 0 || svgSize.h === 0) return null;

  return (
    <svg
      width={svgSize.w}
      height={svgSize.h}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    >
      {paths.map((p, i) => (
        <g key={i}>
          <path
            d={p.d}
            fill="none"
            stroke={LINE_COLOR}
            strokeWidth={LINE_WIDTH}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {p.dots.map((dot, j) => (
            <circle
              key={j}
              cx={dot.cx}
              cy={dot.cy}
              r={3}
              fill={LINE_COLOR}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

// ==================== PagodaTreeView 主组件 ====================

export function PagodaTreeView({
  tree, editable = false,
  onTreeChange,
  onRequestEdit,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (tree: FamilyTree) => void;
  onRequestEdit?: () => void;
}) {
  const [membersCache, setMembersCache] = useState<Member[]>(() => tree.members || []);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [storyFocus, setStoryFocus] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // 当 tree 变化时同步 members
  useEffect(() => {
    setMembersCache(tree.members || []);
  }, [tree.members]);

  const generations = useMemo(() => buildPagodaTree(membersCache), [membersCache]);

  const handleEditMember = useCallback((member: Member) => {
    setEditTarget(member);
    setEditTitle(`编辑 ${member.name}`);
    setStoryFocus(false);
    setShowEditForm(true);
  }, []);

  const handleEditStory = useCallback((member: Member) => {
    setEditTarget(member);
    setEditTitle(`编辑 ${member.name} 的故事`);
    setStoryFocus(true);
    setShowEditForm(true);
  }, []);

  const handleAddParent = useCallback((member: Member) => {
    const newMember: Member = {
      id: generateId(),
      name: "",
      gender: "" as "男" | "女" | undefined,
      birth: "",
      death: "",
      generationWord: "",
      info: "",
      story: "",
      burialPlace: "",
      childrenIds: [member.id],
    };
    setEditTarget(newMember);
    setEditTitle("添加父辈");
    setStoryFocus(false);
    setShowEditForm(true);
  }, []);

  const handleAddChild = useCallback((member: Member) => {
    const newMember: Member = {
      id: generateId(),
      name: "",
      gender: "" as "男" | "女" | undefined,
      birth: "",
      death: "",
      generationWord: "",
      info: "",
      story: "",
      burialPlace: "",
      fatherId: member.gender === "男" ? member.id : "",
      motherId: member.gender === "女" ? member.id : "",
      parentId: member.id,
    };
    setEditTarget(newMember);
    setEditTitle("添加子嗣");
    setStoryFocus(false);
    setShowEditForm(true);
  }, []);

  const handleAddSpouse = useCallback((member: Member) => {
    const isMale = member.gender === "男";
    const newMember: Member = {
      id: generateId(),
      name: "",
      gender: "" as "男" | "女" | undefined,
      birth: "",
      death: "",
      generationWord: "",
      info: "",
      story: "",
      burialPlace: "",
      spouseOf: member.id,
      spouseId: member.id,
    };
    setEditTarget(newMember);
    setEditTitle(isMale ? "添加配偶（妻子）" : "添加配偶（丈夫）");
    setStoryFocus(false);
    setShowEditForm(true);
  }, []);

  const handleUpdateMember = useCallback((updatedMember: Member) => {
    setMembersCache(prev => {
      const idx = prev.findIndex(m => m.id === updatedMember.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updatedMember;
        if (onTreeChange) onTreeChange({ ...tree, members: next });
        return next;
      }
      return prev;
    });
  }, [onTreeChange, tree]);

  const handleFormSave = useCallback((data: EditFormData) => {
    if (!editTarget) return;
    const updated: Member = {
      ...editTarget,
      name: data.name,
      gender: data.gender as "男" | "女" | undefined,
      birth: data.birth,
      death: data.death,
      generationWord: data.generationWord,
      info: data.info,
      story: data.story,
      burialPlace: data.burialPlace,
    };

    const idx = membersCache.findIndex(m => m.id === updated.id);
    if (idx >= 0) {
      handleUpdateMember(updated);
    } else {
      const next = [...membersCache, updated];
      setMembersCache(next);
      if (onTreeChange) onTreeChange({ ...tree, members: next });
    }
    setShowEditForm(false);
    setEditTarget(null);
  }, [editTarget, membersCache, handleUpdateMember, onTreeChange, tree]);

  if (generations.length === 0) {
    return (
      <div className="text-center py-12 text-[#8b7355]/60">
        <p className="text-3xl mb-2">🌳</p>
        <p className="text-sm">暂无家族成员数据</p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-full overflow-hidden pb-8">
      <div className="flex justify-center w-full">
        <div ref={containerRef} className="relative inline-block py-8 px-8 md:px-12">
          {/* 连线层 */}
          <GenerationLines generations={generations} containerRef={containerRef} />
          {/* 各代排列 */}
          <div className="flex flex-col items-center" style={{ gap: GENERATION_V_GAP }}>
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
      </div>

      {/* 编辑弹窗 */}
      {showEditForm && editTarget && (
        <MemberEditForm
          initial={{
            name: editTarget.name || "",
            gender: editTarget.gender || "",
            birth: editTarget.birth || "",
            death: editTarget.death || "",
            generationWord: editTarget.generationWord || "",
            info: editTarget.info || "",
            story: editTarget.story || "",
            burialPlace: editTarget.burialPlace || "",
          }}
          onSave={handleFormSave}
          onCancel={() => { setShowEditForm(false); setEditTarget(null); }}
          title={editTitle}
          storyFocus={storyFocus}
        />
      )}
    </div>
  );
}
