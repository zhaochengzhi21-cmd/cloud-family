"use client";

import { useState } from "react";
import type { Member, MemberMemory } from "@/types/family";

/**
 * 生成简易 ID
 */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 💬 家人回忆
 *
 * 显示在成员详情弹窗底部。
 * - 已审核通过的留言以卡片列表展示
 * - 无留言时显示占位提示
 * - 发布入口：输入框(200字) + 昵称(必填) + 发布按钮
 * - 发布后进入"待审核"状态
 * - 创建者/编辑者看到"待审核"标签，可点击"通过"或"删除"
 * - 阅读者只能看到已通过的留言
 */
export default function MemberMemories({
  member,
  editable = false,
  onUpdateMember,
}: {
  member: Member;
  editable?: boolean;
  onUpdateMember?: (updated: Member) => void;
}) {
  const memories = member.memories || [];
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");

  // 已通过 + 未通过（仅编辑者可见）
  const approved = memories.filter((m) => m.approved);
  const pending = memories.filter((m) => !m.approved);

  /** 发布新留言 */
  const handleSubmit = () => {
    const trimmedContent = content.trim();
    const trimmedAuthor = author.trim();
    if (!trimmedContent || !trimmedAuthor) return;
    if (trimmedContent.length > 200) {
      alert("留言内容不能超过200字");
      return;
    }

    const newMemory: MemberMemory = {
      id: genId(),
      content: trimmedContent,
      author: trimmedAuthor,
      createdAt: new Date().toISOString(),
      approved: false,
    };

    const updated: Member = {
      ...member,
      memories: [...memories, newMemory],
    };
    onUpdateMember?.(updated);
    setContent("");
    // 不清空昵称，方便连续发布
  };

  /** 审核通过 */
  const handleApprove = (id: string) => {
    const updated: Member = {
      ...member,
      memories: memories.map((m) =>
        m.id === id ? { ...m, approved: true } : m
      ),
    };
    onUpdateMember?.(updated);
  };

  /** 删除留言 */
  const handleDelete = (id: string) => {
    if (!confirm("确定删除这条留言？")) return;
    const updated: Member = {
      ...member,
      memories: memories.filter((m) => m.id !== id),
    };
    onUpdateMember?.(updated);
  };

  return (
    <div className="border-t border-[#d4a76a]/20 pt-3 mt-3">
      {/* 标题 */}
      <p className="text-xs font-bold text-[#8b0000]/70 mb-2">💬 家人回忆</p>

      {/* 已通过留言列表 */}
      {approved.length > 0 ? (
        <div className="space-y-2 mb-3">
          {approved.map((m) => (
            <div
              key={m.id}
              className="bg-[#fefcf5] rounded-lg p-2.5 border border-[#d4a76a]/10"
            >
              <p className="text-xs text-[#5c3a2e]/90 whitespace-pre-wrap leading-relaxed">
                {m.content}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-[#c4a67a]">
                  {m.author} · {formatTime(m.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#c4a67a]/70 text-center py-2 italic">
          暂无回忆，成为第一个留下回忆的人
        </p>
      )}

      {/* 待审核列表（仅编辑者可见） */}
      {editable && pending.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[10px] text-amber-600 font-bold">待审核</p>
          {pending.map((m) => (
            <div
              key={m.id}
              className="bg-amber-50/80 rounded-lg p-2.5 border border-amber-200/50"
            >
              <p className="text-xs text-[#5c3a2e]/90 whitespace-pre-wrap leading-relaxed">
                {m.content}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-[#c4a67a]">
                  {m.author} · {formatTime(m.createdAt)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleApprove(m.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                  >
                    通过
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 发布入口 */}
      <div className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="写下对家人的回忆…（200字以内）"
          maxLength={200}
          rows={2}
          className="w-full text-xs border border-[#d4a76a]/20 rounded-lg p-2 resize-none bg-white focus:outline-none focus:border-[#8b0000]/40 focus:ring-1 focus:ring-[#8b0000]/20 text-[#5c3a2e] placeholder:text-[#c4a67a]/60"
        />
        <div className="flex items-center gap-2">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="你的昵称 *"
            className="flex-1 text-xs border border-[#d4a76a]/20 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[#8b0000]/40 text-[#5c3a2e] placeholder:text-[#c4a67a]/60"
          />
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || !author.trim()}
            className="px-3 py-1.5 text-xs rounded-lg bg-[#8b0000] text-white font-bold hover:bg-[#a52a2a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            发布
          </button>
        </div>
      </div>
    </div>
  );
}

/** 格式化时间 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return iso;
  }
}