"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/AuthContext";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "email" | "code";

export default function LoginModal({ open, onClose }: LoginModalProps) {
  const { setAuth } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 重置状态
  const reset = () => {
    setStep("email");
    setEmail("");
    setCode("");
    setLoading(false);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---------- 发送验证码 ----------
  const handleSendCode = async () => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError("请输入有效的邮箱地址");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "发送验证码失败");
        return;
      }

      setStep("code");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // ---------- 提交验证码（登录/注册） ----------
  const handleSubmitCode = async () => {
    if (!code || code.length !== 6) {
      setError("请输入6位验证码");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 先试注册（如果已注册会自动走登录）
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, action: "register" }),
      });
      const data = await res.json();

      if (data.success) {
        // 注册/登录成功
        setAuth(data.data.emailHash, email);
        handleClose();
        return;
      }

      // 如果返回 409 表示已注册，尝试登录
      if (res.status === 409) {
        const loginRes = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code, action: "login" }),
        });
        const loginData = await loginRes.json();

        if (loginData.success) {
          setAuth(loginData.data.emailHash, email);
          handleClose();
          return;
        }

        setError(loginData.error || "登录失败");
        return;
      }

      setError(data.error || "操作失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 回车键提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (step === "email") handleSendCode();
      else handleSubmitCode();
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
            云族谱 · 登录
          </h2>
          <p className="text-sm text-[#c4a67a] mt-2 tracking-wider">
            {step === "email"
              ? "输入邮箱地址，接收验证码"
              : "请输入邮件中的6位验证码"}
          </p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        {step === "email" ? (
          // ===== 第一步：输入邮箱 =====
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-[#5c3a2e] mb-2 tracking-wider">
                邮箱地址
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-[#fdfbf7] border-2 border-[#d4a76a]/50 rounded-xl text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:border-[#8b0000] focus:ring-2 focus:ring-[#8b0000]/20 transition-all duration-300"
              />
            </div>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold tracking-wider text-base bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  发送中...
                </span>
              ) : (
                "发送验证码"
              )}
            </button>
          </div>
        ) : (
          // ===== 第二步：输入验证码 =====
          <div className="space-y-4">
            <div className="text-center mb-2">
              <p className="text-sm text-[#5c3a2e]">
                验证码已发送至
              </p>
              <p className="text-sm font-bold text-[#8b0000]">
                {email}
              </p>
              <button
                type="button"
                onClick={() => setStep("email")}
                className="text-xs text-[#c4a67a] hover:text-[#8b0000] underline mt-1 transition-colors"
              >
                更换邮箱
              </button>
            </div>

            <div>
              <label className="block text-sm font-bold text-[#5c3a2e] mb-2 tracking-wider">
                验证码
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={handleKeyDown}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 bg-[#fdfbf7] border-2 border-[#d4a76a]/50 rounded-xl text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:border-[#8b0000] focus:ring-2 focus:ring-[#8b0000]/20 transition-all duration-300 text-center text-2xl tracking-[0.5em] font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmitCode}
              disabled={loading || code.length !== 6}
              className="w-full py-3 rounded-xl font-bold tracking-wider text-base bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  验证中...
                </span>
              ) : (
                "登录 / 注册"
              )}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading}
                className="text-xs text-[#c4a67a] hover:text-[#8b0000] underline transition-colors"
              >
                重新发送验证码
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}