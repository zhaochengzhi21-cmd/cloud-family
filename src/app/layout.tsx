"use client";

import React, { useState } from "react";
import "./globals.css";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import LoginModal from "@/components/LoginModal";

/**
 * 顶部导航栏（含登录按钮）
 */
function Header() {
  const { isLoggedIn, maskedEmail, logout } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <header className="relative z-20 bg-white/90 backdrop-blur-sm border-b border-[#d4a76a]/20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* 左侧 Logo / 首页链接 */}
          <a
            href="/"
            className="text-lg font-black text-[#8b0000] tracking-wider hover:text-[#a52a2a] transition-colors"
          >
            云族谱
          </a>

          {/* 右侧：用户状态 */}
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <>
                <a
                  href="/"
                  className="text-sm font-bold text-[#5c3a2e] hover:text-[#8b0000] transition-colors"
                >
                  我的家族
                </a>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#c4a67a] font-medium">
                    {maskedEmail}
                  </span>
                  <button
                    onClick={logout}
                    className="px-3 py-1.5 text-xs font-bold text-[#c4a67a] border border-[#d4a76a]/30 rounded-lg hover:border-[#8b0000]/50 hover:text-[#8b0000] transition-all"
                  >
                    退出
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="px-4 py-1.5 text-sm font-bold bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white rounded-xl hover:shadow-lg transition-all"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}