"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import LoginModal from "@/components/LoginModal";

/**
 * 家族条目接口
 */
interface FamilyItem {
  familyId: string;
  familyName: string;
  createdAt: string;
  role: "creator" | "editor";
  memberCount: number;
}

/**
 * 格式化日期
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y} 年 ${m} 月 ${day} 日`;
  } catch {
    return iso;
  }
}

/**
 * 角色徽章
 */
function RoleBadge({ role }: { role: "creator" | "editor" }) {
  if (role === "creator") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#8b0000]/10 text-[#8b0000] border border-[#8b0000]/20">
        <span>👑</span>
        <span>创建者</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#d4a76a]/20 text-[#7a4e3a] border border-[#d4a76a]/30">
      <span>✏️</span>
      <span>编辑者</span>
    </span>
  );
}

/**
 * 我的家族页面
 */
export default function MyFamiliesPage() {
  const router = useRouter();
  const { isLoggedIn, emailHash } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [families, setFamilies] = useState<FamilyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---------- 获取家族列表 ----------
  const fetchFamilies = useCallback(async () => {
    if (!isLoggedIn) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/my-families");
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "获取家族列表失败");
      }

      setFamilies(data.families || []);
    } catch (err: any) {
      console.error("fetchFamilies error:", err);
      setError(err.message || "加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    fetchFamilies();
  }, [fetchFamilies]);

  // ---------- 进入家族详情 ----------
  const handleEnterFamily = useCallback(
    (familyId: string) => {
      router.push(`/family/${familyId}`);
    },
    [router]
  );

  // ---------- 创建新家族 ----------
  const handleCreateNew = useCallback(() => {
    router.push("/");
  }, [router]);

  // ========== 渲染 ==========

  // ---- 未登录状态 ----
  if (!isLoggedIn) {
    return (
      <div className="relative min-h-screen bg-[#f5f0e8]">
        {/* 顶部装饰线 */}
        <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />

        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-16">
          {/* 主卡片 */}
          <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-10 text-center">
            {/* 图标 */}
            <div className="text-7xl mb-6">🏮</div>

            <h1 className="text-3xl font-black text-[#8b0000] tracking-wider mb-3">
              我的家族
            </h1>

            <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-6" />

            <p className="text-[#5c3a2e] text-lg leading-relaxed mb-8">
              请先登录以查看您的家族
            </p>

            <button
              onClick={() => setShowLoginModal(true)}
              className="px-10 py-3 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-lg tracking-wider hover:shadow-xl transition-all active:scale-[0.98]"
            >
              立即登录
            </button>

            <div className="mt-6">
              <a
                href="/"
                className="text-sm text-[#c4a67a] hover:text-[#8b0000] underline transition-colors"
              >
                返回首页
              </a>
            </div>
          </div>
        </div>

        {/* 登录弹窗 */}
        <LoginModal
          open={showLoginModal}
          onClose={() => setShowLoginModal(false)}
        />
      </div>
    );
  }

  // ---- 加载骨架屏 ----
  if (loading) {
    return (
      <div className="relative min-h-screen bg-[#f5f0e8]">
        <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />

        <div className="relative z-10 max-w-4xl mx-auto px-4 py-10">
          {/* 骨架标题区 */}
          <div className="text-center mb-10">
            <div className="h-10 w-48 bg-gray-200/60 rounded-lg animate-pulse mx-auto mb-3" />
            <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-gray-300 to-transparent mx-auto mb-5" />
            <div className="h-5 w-32 bg-gray-200/60 rounded animate-pulse mx-auto" />
          </div>

          {/* 骨架按钮 */}
          <div className="flex justify-center mb-10">
            <div className="h-12 w-44 bg-gray-200/60 rounded-xl animate-pulse" />
          </div>

          {/* 骨架卡片列表 */}
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-full bg-white/70 backdrop-blur-sm rounded-2xl shadow-md border border-[#d4a76a]/10 p-5 md:p-6 animate-pulse"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* 家族名 */}
                    <div className="h-7 w-3/5 bg-gray-200/70 rounded-md mb-3" />
                    {/* 详情信息 */}
                    <div className="flex flex-wrap items-center gap-3 mt-3">
                      <div className="h-4 w-28 bg-gray-200/50 rounded" />
                      <div className="h-4 w-32 bg-gray-200/50 rounded" />
                    </div>
                    {/* 角色标签 */}
                    <div className="mt-3">
                      <div className="h-5 w-16 bg-gray-200/60 rounded-full" />
                    </div>
                  </div>
                  {/* 右侧箭头 */}
                  <div className="shrink-0 pt-1">
                    <div className="h-5 w-5 bg-gray-200/40 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- 错误状态 ----
  if (error) {
    return (
      <div className="relative min-h-screen bg-[#f5f0e8]">
        <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />
        <div className="flex items-center justify-center min-h-[calc(100vh-56px)] px-4">
          <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-10 text-center">
            <div className="text-5xl mb-4">😵</div>
            <p className="text-[#5c3a2e] mb-2 text-lg font-bold">加载失败</p>
            <p className="text-sm text-red-600 mb-6">{error}</p>
            <button
              onClick={fetchFamilies}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm tracking-wider hover:shadow-lg transition-all"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- 已登录 + 无家族 ----
  if (families.length === 0) {
    return (
      <div className="relative min-h-screen bg-[#f5f0e8]">
        {/* 顶部装饰线 */}
        <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />

        {/* 背景粒子 Canvas */}
        <canvas
          id="bg-canvas"
          className="absolute inset-0 pointer-events-none opacity-30"
        />

        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-16">
          {/* 主卡片 */}
          <div className="w-full max-w-md bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-10 text-center">
            {/* 图标 */}
            <div className="text-7xl mb-6">📜</div>

            <h1 className="text-3xl font-black text-[#8b0000] tracking-wider mb-3">
              我的家族
            </h1>

            <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-6" />

            <p className="text-[#5c3a2e] text-lg leading-relaxed mb-8">
              您还没有创建或参与任何家族
            </p>

            <button
              onClick={handleCreateNew}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-base tracking-wider hover:shadow-xl transition-all active:scale-[0.98] flex items-center gap-2 mx-auto"
            >
              <span>🏠</span>
              <span>创建新家族</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- 已登录 + 有家族列表 ----
  return (
    <div className="relative min-h-screen bg-[#f5f0e8]">
      {/* 顶部装饰线 */}
      <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />

      {/* 背景粒子 Canvas */}
      <canvas
        id="bg-canvas"
        className="absolute inset-0 pointer-events-none opacity-30"
      />

      {/* 云纹装饰 */}
      <div className="absolute top-20 left-0 right-0 flex justify-center pointer-events-none opacity-10">
        <svg width="800" height="40" viewBox="0 0 800 40" fill="none">
          <path
            d="M0 20 Q100 0 200 20 Q300 40 400 20 Q500 0 600 20 Q700 40 800 20"
            stroke="#8b0000"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* 主内容 */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-10">
        {/* 标题区 */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-black text-[#8b0000] tracking-widest mb-3">
            我的家族
          </h1>
          <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-5" />
          <p className="text-[#5c3a2e] text-base md:text-lg">
            共 {families.length} 个家族
          </p>
        </div>

        {/* 创建新家族按钮 */}
        <div className="flex justify-center mb-10">
          <button
            onClick={handleCreateNew}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-base tracking-wider hover:shadow-xl transition-all active:scale-[0.98] flex items-center gap-2"
          >
            <span>🏠</span>
            <span>创建新家族</span>
          </button>
        </div>

        {/* 家族列表 */}
        <div className="space-y-4">
          {families.map((family) => (
            <button
              key={family.familyId}
              onClick={() => handleEnterFamily(family.familyId)}
              className="w-full text-left group bg-white/90 backdrop-blur-sm rounded-2xl shadow-md border border-[#d4a76a]/20 p-5 md:p-6 hover:shadow-xl hover:border-[#8b0000]/30 transition-all duration-300 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-4">
                {/* 左侧信息 */}
                <div className="flex-1 min-w-0">
                  {/* 家族名 */}
                  <h2 className="text-xl md:text-2xl font-black text-[#5c3a2e] group-hover:text-[#8b0000] transition-colors truncate">
                    {family.familyName}
                  </h2>

                  {/* 详情信息 */}
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    {/* 创建时间 */}
                    <span className="inline-flex items-center gap-1 text-xs text-[#c4a67a]">
                      <span>📅</span>
                      <span>{formatDate(family.createdAt)}</span>
                    </span>

                    {/* 成员数 */}
                    <span className="inline-flex items-center gap-1 text-xs text-[#c4a67a]">
                      <span>👥</span>
                      <span>{family.memberCount > 0 ? `${family.memberCount} 位成员` : "暂无成员数据"}</span>
                    </span>
                  </div>

                  {/* 角色标签 */}
                  <div className="mt-3">
                    <RoleBadge role={family.role} />
                  </div>
                </div>

                {/* 右侧箭头 */}
                <div className="shrink-0 flex items-center pt-1">
                  <span className="text-[#c4a67a] group-hover:text-[#8b0000] transition-colors text-xl">
                    →
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 页脚 */}
      <div className="relative z-10 text-center py-6 mt-8">
        <p className="text-xs text-[#c4a67a] tracking-wider">
          云族谱 · 永久免费 · 让家谱永存
        </p>
      </div>
    </div>
  );
}