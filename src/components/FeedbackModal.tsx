"use client";

import React, { useState } from "react";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setContent("");
    setContact("");
    setLoading(false);
    setSuccess(false);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError("请填写反馈内容");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          contact: contact.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "提交失败，请稍后重试");
        return;
      }

      setSuccess(true);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* 弹窗 */}
      <div className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-8 z-10">
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-[#c4a67a] hover:text-[#8b0000] transition-colors rounded-full hover:bg-[#f5f0e8]"
        >
          ✕
        </button>

        {/* 标题 */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-black text-[#8b0000] tracking-wider">
            💬 意见反馈
          </h2>
          <p className="text-sm text-[#c4a67a] mt-2 tracking-wider">
            您的建议是我们前进的动力
          </p>
        </div>

        {success ? (
          // 提交成功
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🙏</div>
            <p className="text-lg font-bold text-[#8b0000] mb-2">
              感谢您的反馈！
            </p>
            <p className="text-sm text-[#5c3a2e]/70">
              我们会认真对待每一条建议
            </p>
            <button
              onClick={handleClose}
              className="mt-6 px-6 py-2 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm hover:shadow-lg transition-all"
            >
              关闭
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 错误提示 */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center">
                {error}
              </div>
            )}

            {/* 反馈内容 */}
            <div>
              <label className="block text-sm font-bold text-[#5c3a2e] mb-2 tracking-wider">
                反馈内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="请描述您的建议、问题或想法..."
                rows={4}
                maxLength={1000}
                className="w-full px-4 py-3 bg-[#fdfbf7] border-2 border-[#d4a76a]/50 rounded-xl text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:border-[#8b0000] focus:ring-2 focus:ring-[#8b0000]/20 transition-all duration-300 resize-none"
              />
              <p className="text-xs text-[#c4a67a] mt-1 text-right">
                {content.length}/1000
              </p>
            </div>

            {/* 联系方式（可选） */}
            <div>
              <label className="block text-sm font-bold text-[#5c3a2e] mb-2 tracking-wider">
                联系方式 <span className="text-[#c4a67a] font-normal">（选填，邮箱或手机号）</span>
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="方便我们与您联系..."
                className="w-full px-4 py-3 bg-[#fdfbf7] border-2 border-[#d4a76a]/50 rounded-xl text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:border-[#8b0000] focus:ring-2 focus:ring-[#8b0000]/20 transition-all duration-300"
              />
            </div>

            {/* 提交按钮 */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !content.trim()}
              className="w-full py-3 rounded-xl font-bold tracking-wider text-base bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  提交中...
                </span>
              ) : (
                "提交反馈"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}