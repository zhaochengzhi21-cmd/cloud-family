"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import FamilyCertificate from "@/components/FamilyCertificate";
import { PagodaTreeView } from "@/components/FamilyTreePagoda";
import { FamilyTimeline } from "@/components/FamilyTimeline";
import RevisionHistory from "@/components/RevisionHistory";
import FamilyPoster from "@/components/FamilyPoster";
import { FamilyAlbum } from "@/components/FamilyAlbum";
import { getImageUrls } from "@/lib/ipfsGateway";
import { useAuth } from "@/lib/AuthContext";
import LoginModal from "@/components/LoginModal";
import type { FamilyTree } from "@/types/family";

// ---------- 类型定义 ----------
interface IpfsData {
  type?: string;
  data?: FamilyTree;
  familyName?: string;
  ipfsDirCid?: string;
  imageCount?: number;
  timestamp?: string;
}

interface FetchResult {
  success: boolean;
  familyId?: string;
  dataHash?: string;
  ipfsData?: IpfsData | null;
  error?: string;
  warning?: string;
}

// ---------- 加载骨架屏 ----------
function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full border-4 border-[#8b0000]/20 border-t-[#8b0000] animate-spin" />
        <p className="text-[#8b0000] text-lg">正在加载数据...</p>
      </div>
    </div>
  );
}

// ---------- 错误视图 ----------
function ErrorView({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center px-4">
      <div className="bg-white/90 rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">
        <div className="text-5xl">🥺</div>
        <h2 className="text-2xl font-bold text-[#8b0000]">数据未找到</h2>
        <p className="text-[#5c3a2e]">{message}</p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold hover:bg-[#a52a2a] transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}

// ==================== 老谱文件模式（原有图片展示 + AI 修复） ====================
function LegacyContentView({ ipfsData, dataHash }: { ipfsData: IpfsData; dataHash?: string }) {
  const familyName = ipfsData.familyName || "家族族谱";
  const imageCount = ipfsData.imageCount ?? 0;
  const [restoringIndex, setRestoringIndex] = useState<number | null>(null);
  const [restoredImages, setRestoredImages] = useState<Record<number, string>>({});
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // AI 修复单张照片
  const handleRestore = useCallback(async (index: number, imageUrl: string) => {
    setRestoringIndex(index);
    setRestoreError(null);
    try {
      const res = await fetch("/api/restore-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (data.restoredUrl) {
        setRestoredImages((prev) => ({ ...prev, [index]: data.restoredUrl }));
      } else {
        setRestoreError(data.error || "修复失败");
        setTimeout(() => setRestoreError(null), 3000);
      }
    } catch (err) {
      setRestoreError("修复服务暂不可用");
      setTimeout(() => setRestoreError(null), 3000);
    } finally {
      setRestoringIndex(null);
    }
  }, []);

  return (
    <>
      {/* 标题 */}
      <section className="text-center">
        <h1 className="text-4xl md:text-5xl font-black text-[#8b0000] tracking-widest mb-3">
          {familyName}
        </h1>
        <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-5" />
        <p className="text-lg text-[#5c3a2e]">
          老谱影像
        </p>
      </section>

      {/* 图片画廊 */}
      {imageCount > 0 && dataHash && (
        <section>
          <h2 className="text-xl font-bold text-[#8b0000] mb-4 tracking-wider">
            老谱影像（{imageCount} 张）
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: imageCount }, (_, i) => {
              const imageUrls = getImageUrls(dataHash, String(i));
              const originalUrl = imageUrls[0];
              const displayUrl = restoredImages[i] || originalUrl;
              return (
                <div
                  key={i}
                  className="bg-white rounded-xl shadow-md border border-[#d4a76a]/20 overflow-hidden hover:shadow-lg transition-shadow"
                >
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="relative">
                      <img
                        src={displayUrl}
                        alt={`老谱影像 ${i + 1}`}
                        className="w-full h-64 object-contain bg-[#fdfbf7] p-2"
                        loading="lazy"
                      />
                      {restoringIndex === i && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="bg-white/90 rounded-xl px-4 py-2 shadow-lg">
                            <div className="w-5 h-5 border-2 border-[#8b0000] border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                            <span className="text-xs font-bold text-[#8b0000]">AI 修复中...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </a>
                  <div className="px-4 py-2 bg-[#fdfbf7] border-t border-[#d4a76a]/10 flex items-center justify-between">
                    <p className="text-sm text-[#5c3a2e]">
                      第 {i + 1} 页
                    </p>
                    <button
                      onClick={() => handleRestore(i, originalUrl)}
                      disabled={restoringIndex !== null}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all duration-200 ${
                        restoredImages[i]
                          ? "bg-green-100 text-green-700 border border-green-300 cursor-default"
                          : "bg-[#fdfbf7] text-[#8b0000] border border-[#d4a76a]/40 hover:bg-[#8b0000]/5 hover:border-[#8b0000]/30 disabled:opacity-40"
                      }`}
                    >
                      {restoringIndex === i
                        ? "修复中…"
                        : restoredImages[i]
                        ? "✓ 已修复"
                        : "✨ AI 修复"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {imageCount === 0 && (
        <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8 text-center">
          <p className="text-[#c4a67a]">该谱牒暂无影像资料</p>
        </section>
      )}
    </>
  );
}

// ==================== Hero 区域组件 ====================
function FamilyHero({
  familyName,
  totalGenerations,
  totalMembers,
}: {
  familyName: string;
  totalGenerations: number;
  totalMembers: number;
}) {
  return (
    <section className="text-center py-8 md:py-12">
      {/* 家族名称大标题 */}
      <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-[#8b0000] tracking-widest mb-4">
        {familyName}
      </h1>
      {/* 装饰分隔线 */}
      <div className="w-32 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-4" />
      {/* 代数 + 成员数 */}
      <p className="text-base md:text-lg text-[#5c3a2e] tracking-wider">
        <span className="inline-flex items-center gap-1.5">
          <span>🌳</span>
          <span className="font-bold text-[#8b0000]">{totalGenerations}</span>
          <span>代 ·</span>
          <span className="font-bold text-[#8b0000]">{totalMembers}</span>
          <span>位族人</span>
        </span>
      </p>
    </section>
  );
}

// ==================== 主页面 ====================
export default function FamilyPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const router = useRouter();
  const { isLoggedIn } = useAuth();

  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedTree, setEditedTree] = useState<FamilyTree | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "album" | "memories">("timeline");

  // 邮箱备份状态
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [showPoster, setShowPoster] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [editors, setEditors] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // 邀请编辑者
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [removeEditorHash, setRemoveEditorHash] = useState<string>("");
  const [removeSending, setRemoveSending] = useState(false);

  // 获取编辑权限
  useEffect(() => {
    if (!familyId) return;
    const fetchSettings = async () => {
      try {
        const res = await fetch(`/api/family-settings/${familyId}`);
        const data = await res.json();
        if (data.success) {
          setCanEdit(data.canEdit || false);
          setIsCreator(data.isCreator || false);
          setEditors(data.editors || []);
        }
      } catch {
        // 权限获取失败，默认不可编辑
      } finally {
        setSettingsLoaded(true);
      }
    };
    fetchSettings();
  }, [familyId]);

  // 邀请编辑者
  const handleInviteEditor = useCallback(async () => {
    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed || !/\S+@\S+\.\S+/.test(trimmed)) {
      setInviteError("请输入有效的邮箱地址");
      return;
    }
    setInviteSending(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch(`/api/family-settings/${familyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (data.success) {
        setInviteSuccess(`已邀请 ${trimmed}，对方登录后即可编辑`);
        setInviteEmail("");
        setEditors(data.editors || []);
      } else {
        setInviteError(data.error || "邀请失败");
      }
    } catch {
      setInviteError("网络异常，请稍后重试");
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, familyId]);

  // 移除编辑者
  const handleRemoveEditor = useCallback(async (editorHash: string) => {
    setRemoveEditorHash(editorHash);
    setRemoveSending(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch(`/api/family-settings/${familyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeEditorEmailHash: editorHash }),
      });
      const data = await res.json();
      if (data.success) {
        setInviteSuccess("已移除编辑者");
        setEditors(data.editors || []);
      } else {
        setInviteError(data.error || "移除失败");
      }
    } catch {
      setInviteError("网络异常，请稍后重试");
    } finally {
      setRemoveEditorHash("");
      setRemoveSending(false);
    }
  }, [familyId]);

  // 防搜索引擎收录
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
  }, []);

  // ---------- 智能判断数据类型 ----------
  const isStructuredTree =
    result?.ipfsData &&
    result.ipfsData.type === "family-tree" &&
    Array.isArray(result.ipfsData.data?.members);

  // ---------- 提取展示用数据 ----------
  const ipfsData = result?.ipfsData;
  const familyName = isStructuredTree
    ? ipfsData?.data?.familyName || "家族族谱"
    : ipfsData?.familyName || "家族族谱";

  // ---------- 代数/成员数计算 ----------
  const treeData = result?.ipfsData?.data;
  const totalMembers = treeData?.members?.length || 0;

  const totalGenerations = (() => {
    const members = treeData?.members;
    if (!members || members.length === 0) return 1;

    // 以 fatherId / motherId / parentId 作为亲子关系依据
    const findRoots = () =>
      members.filter(
        (m) =>
          !m.fatherId && !m.motherId && !m.parentId
      );

    // 查找某成员的所有子女（通过 fatherId / motherId / parentId）
    const getChildren = (id: string) =>
      members.filter(
        (m) =>
          m.parentId === id ||
          m.fatherId === id ||
          m.motherId === id
      );

    const roots = findRoots();
    if (roots.length === 0) {
      // 如果找不到始祖节点，使用 childrenIds 反向推断最顶层节点
      const allWithParents = new Set<string>();
      for (const m of members) {
        if (m.fatherId) allWithParents.add(m.fatherId);
        if (m.motherId) allWithParents.add(m.motherId);
        if (m.parentId) allWithParents.add(m.parentId);
      }
      const rootCandidates = members
        .filter((m) => !allWithParents.has(m.id))
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      if (rootCandidates.length === 0) return 1;
      // 按 BFS 计算代数
      const genMap: Record<string, number> = {};
      const queue: { id: string; gen: number }[] = rootCandidates.map((r) => ({ id: r.id, gen: 1 }));
      let maxGen = 1;
      while (queue.length > 0) {
        const { id, gen } = queue.shift()!;
        if (genMap[id] !== undefined && genMap[id] >= gen) continue;
        genMap[id] = gen;
        maxGen = Math.max(maxGen, gen);
        for (const child of getChildren(id)) {
          if (genMap[child.id] === undefined || genMap[child.id] < gen + 1) {
            queue.push({ id: child.id, gen: gen + 1 });
          }
        }
      }
      return maxGen;
    }

    const genMap: Record<string, number> = {};
    const queue: { id: string; gen: number }[] = roots.map((r) => ({ id: r.id, gen: 1 }));
    let maxGen = 1;
    while (queue.length > 0) {
      const { id, gen } = queue.shift()!;
      if (genMap[id] !== undefined && genMap[id] >= gen) continue;
      genMap[id] = gen;
      maxGen = Math.max(maxGen, gen);
      for (const child of getChildren(id)) {
        if (genMap[child.id] === undefined || genMap[child.id] < gen + 1) {
          queue.push({ id: child.id, gen: gen + 1 });
        }
      }
    }
    return maxGen;
  })();

  // 找始祖
  const founderName = treeData?.members?.find((m) => !m.parentId)?.name || treeData?.members?.[0]?.name || "";

  const rawTimestamp = ipfsData?.timestamp;
  const displayTimestamp = rawTimestamp
    ? new Date(rawTimestamp).toLocaleString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Shanghai",
      })
    : undefined;

  // 重新加载数据
  const reloadData = useCallback(async () => {
    if (!familyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/get-family/${familyId}`);
      const data: FetchResult = await res.json();
      if (!data.success) {
        setError(data.error || "获取数据失败");
        return;
      }
      setResult(data);
      setEditing(false);
      setEditedTree(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    if (!familyId) return;

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/get-family/${familyId}`);
        const data: FetchResult = await res.json();

        if (!data.success) {
          setError(data.error || "获取数据失败");
          return;
        }

        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络请求失败");
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchData, 300);
    return () => clearTimeout(timer);
  }, [familyId]);

  // 保存修订
  const handleSaveRevision = useCallback(async () => {
    if (!editedTree || !familyId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/save-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editedTree),
      });
      const data = await res.json();
      if (!data.success) {
        alert(`保存失败: ${data.error || "未知错误"}`);
        return;
      }
      alert("保存成功！页面将刷新展示最新数据。");
      if (data.familyId && data.familyId !== familyId) {
        router.replace(`/family/${data.familyId}`);
      } else {
        await reloadData();
      }
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : "网络错误"}`);
    } finally {
      setSaving(false);
    }
  }, [editedTree, familyId, reloadData, router]);

  // 进入编辑模式
  const enterEditMode = useCallback(() => {
    if (result?.ipfsData?.data) {
      setEditedTree(result.ipfsData.data);
      setEditing(true);
    }
  }, [result]);

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditedTree(null);
  }, []);

  // 复制链接
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("复制失败，请手动复制地址栏链接");
    }
  }, []);

  // 收藏
  const handleFavorite = useCallback(() => {
    try {
      const favKey = "yunzupu_favorites";
      const raw = localStorage.getItem(favKey);
      const favorites: string[] = raw ? JSON.parse(raw) : [];
      if (favorited) {
        const idx = favorites.indexOf(familyId);
        if (idx > -1) favorites.splice(idx, 1);
      } else {
        if (!favorites.includes(familyId)) favorites.push(familyId);
      }
      localStorage.setItem(favKey, JSON.stringify(favorites));
      setFavorited(!favorited);
    } catch {
      // ignore
    }
  }, [familyId, favorited]);

  // 检查是否已收藏
  useEffect(() => {
    try {
      const favKey = "yunzupu_favorites";
      const raw = localStorage.getItem(favKey);
      const favorites: string[] = raw ? JSON.parse(raw) : [];
      setFavorited(favorites.includes(familyId));
    } catch {
      // ignore
    }
  }, [familyId]);

  // 分享
  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "云族谱 - 家族树",
          url,
        });
      } catch {
        // user cancelled or error
      }
    } else {
      await handleCopyLink();
    }
  }, [handleCopyLink]);

  // 下载证书
  const handleDownloadCert = useCallback(() => {
    const certEl = document.getElementById("family-certificate-wrapper");
    if (certEl) {
      certEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      alert("证书尚未加载，请稍后再试");
    }
  }, []);

  // 发送邮箱备份
  const handleEmailBackup = useCallback(async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email.trim())) {
      setEmailError("请输入有效的邮箱地址");
      return;
    }
    setEmailSending(true);
    setEmailError(null);
    try {
      const res = await fetch("/api/email-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          familyId,
          familyName,
          url: window.location.href,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setEmailError(data.error || "发送失败，请稍后重试");
      } else {
        setEmailSent(true);
      }
    } catch {
      setEmailError("网络异常，请稍后重试");
    } finally {
      setEmailSending(false);
    }
  }, [email, familyId, familyName]);

  // ---------- 加载中 ----------
  if (loading) return <LoadingSkeleton />;

  // ---------- 错误 ----------
  if (error) return <ErrorView message={error} />;

  // ---------- 没有数据 ----------
  if (!ipfsData) {
    return (
      <div className="min-h-screen bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <ErrorView message={result?.warning || "无法获取数据"} />
        </div>
      </div>
    );
  }

  // ---------- 未登录：受限访问 ----------
  if (!isLoggedIn) {
    const description = (ipfsData as any)?.description || "";

    return (
      <div className="min-h-screen bg-[#f5f0e8]">
        {/* 顶部导航 */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-[#d4a76a]/20 sticky top-0 z-40">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link
              href="/"
              className="text-[#8b0000] font-black text-xl tracking-widest hover:opacity-80 transition-opacity"
            >
              云族谱
            </Link>
            <Link
              href="/"
              className="text-sm text-[#5c3a2e] hover:text-[#8b0000] transition-colors ml-2"
            >
              ← 返回
            </Link>
          </div>
        </div>

        {/* 受限视图 */}
        <div className="max-w-3xl mx-auto px-4 py-16 md:py-24">
          <div className="text-center">
            {/* 家族名称 */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-[#8b0000] tracking-widest mb-4">
              {familyName}
            </h1>
            <div className="w-32 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-6" />

            {/* 家族简介 */}
            {description && (
              <p className="text-base md:text-lg text-[#5c3a2e] leading-relaxed mb-8 max-w-xl mx-auto">
                {description}
              </p>
            )}

            {/* 锁图标 + 引导提示 */}
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-[#d4a76a]/30 p-10 max-w-md mx-auto">
              <div className="text-6xl mb-6">🔒</div>
              <p className="text-[#5c3a2e] text-lg font-bold mb-2">
                登录后可查看家族树和成员信息
              </p>
              <p className="text-sm text-[#c4a67a] mb-8">
                族谱数据仅对登录用户开放，请先登录以查看完整内容
              </p>
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-10 py-3 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-lg tracking-wider hover:shadow-xl transition-all active:scale-[0.98]"
              >
                立即登录
              </button>
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

  // ========== 渲染 ==========
  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      {/* 顶部导航 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-[#d4a76a]/20 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="text-[#8b0000] font-black text-xl tracking-widest hover:opacity-80 transition-opacity"
          >
            云族谱
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={handleFavorite}
              className={`text-xl transition-all duration-200 hover:scale-110 ${
                favorited ? "opacity-100" : "opacity-60 hover:opacity-100"
              }`}
              title={favorited ? "已收藏" : "收藏"}
            >
              {favorited ? "❤️" : "🤍"}
            </button>
            <button
              onClick={handleCopyLink}
              className="text-xl opacity-60 hover:opacity-100 hover:scale-110 transition-all duration-200"
              title={copied ? "已复制" : "复制链接"}
            >
              🔗
            </button>
            <button
              onClick={handleShare}
              className="text-xl opacity-60 hover:opacity-100 hover:scale-110 transition-all duration-200"
              title="分享"
            >
              📤
            </button>
            <Link
              href="/"
              className="text-sm text-[#5c3a2e] hover:text-[#8b0000] transition-colors ml-2"
            >
              ← 返回
            </Link>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        {/* ====== Hero 区域 ====== */}
        {isStructuredTree ? (
          <FamilyHero
            familyName={familyName}
            totalGenerations={totalGenerations}
            totalMembers={totalMembers}
          />
        ) : (
          <section className="text-center py-8">
            <h1 className="text-4xl md:text-5xl font-black text-[#8b0000] tracking-widest mb-3">
              {familyName}
            </h1>
            <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-5" />
            <p className="text-lg text-[#5c3a2e]">老谱影像</p>
          </section>
        )}

        {/* ====== 结构化家族树内容 ====== */}
        {isStructuredTree && result.ipfsData?.data ? (
          <>
            {/* ====== 工具栏（家族树上方） ====== */}
            <section className="mb-6">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {/* 编辑/保存按钮 */}
                {settingsLoaded && canEdit && (
                  editing ? (
                    <>
                      <button
                        onClick={handleSaveRevision}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 shadow-lg shadow-[#8b0000]/20"
                      >
                        {saving ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            保存中...
                          </>
                        ) : (
                          <>
                            <span>💾</span>
                            <span>保存修订</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors disabled:opacity-40"
                      >
                        <span>✕</span>
                        <span>取消</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={enterEditMode}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors shadow-lg shadow-[#8b0000]/20"
                    >
                      <span>✏️</span>
                      <span>编辑</span>
                    </button>
                  )
                )}

                {/* 生成海报 */}
                <button
                  onClick={() => setShowPoster(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-[#5c3a2e] rounded-xl font-bold text-sm border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7] transition-all duration-200"
                >
                  <span>🖼️</span>
                  <span>生成海报</span>
                </button>

                {/* 下载证书 */}
                <button
                  onClick={handleDownloadCert}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-[#5c3a2e] rounded-xl font-bold text-sm border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7] transition-all duration-200"
                >
                  <span>📄</span>
                  <span>下载证书</span>
                </button>

                {/* 邮箱备份 */}
                <button
                  onClick={() => {
                    const emailSection = document.getElementById("email-backup-section");
                    if (emailSection) {
                      emailSection.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-[#5c3a2e] rounded-xl font-bold text-sm border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7] transition-all duration-200"
                >
                  <span>📧</span>
                  <span>邮箱备份</span>
                </button>
              </div>

              {/* 编辑模式提示 */}
              {editing && (
                <div className="mt-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-center">
                  <p className="text-xs text-amber-700 font-bold">
                    ✏️ 您正在编辑家族树 — 点击成员卡片上的「+」按钮添加父辈/子嗣/配偶，或点击卡片修改信息
                  </p>
                </div>
              )}
            </section>

            {/* ====== 家族树（始终可见，核心区域） ====== */}
            <section className="mb-8">
              <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-4 md:p-6">
                <PagodaTreeView
                  tree={editing && editedTree ? editedTree : result.ipfsData.data}
                  editable={editing}
                  onTreeChange={editing ? (newTree: FamilyTree) => setEditedTree(newTree) : undefined}
                  onRequestEdit={enterEditMode}
                />
              </div>
            </section>

            {/* ====== 标签页切换（家族树下方） ====== */}
            <section className="mb-8">
              {/* 标签按钮 */}
              <div className="flex justify-center gap-2 mb-6">
                <button
                  onClick={() => setActiveTab("timeline")}
                  className={`px-6 py-2.5 rounded-xl font-bold text-sm tracking-wider transition-all duration-200 ${
                    activeTab === "timeline"
                      ? "bg-[#8b0000] text-white shadow-lg shadow-[#8b0000]/20"
                      : "bg-white text-[#5c3a2e] border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7]"
                  }`}
                >
                  📅 时间轴
                </button>
                <button
                  onClick={() => setActiveTab("album")}
                  className={`px-6 py-2.5 rounded-xl font-bold text-sm tracking-wider transition-all duration-200 ${
                    activeTab === "album"
                      ? "bg-[#8b0000] text-white shadow-lg shadow-[#8b0000]/20"
                      : "bg-white text-[#5c3a2e] border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7]"
                  }`}
                >
                  🖼️ 相册
                </button>
                <button
                  onClick={() => setActiveTab("memories")}
                  className={`px-6 py-2.5 rounded-xl font-bold text-sm tracking-wider transition-all duration-200 ${
                    activeTab === "memories"
                      ? "bg-[#8b0000] text-white shadow-lg shadow-[#8b0000]/20"
                      : "bg-white text-[#5c3a2e] border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7]"
                  }`}
                >
                  💭 回忆留言
                </button>
              </div>

              {/* 标签内容 */}
              {activeTab === "timeline" ? (
                <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-4 md:p-6">
                  <FamilyTimeline
                    tree={editing && editedTree ? editedTree : result.ipfsData.data}
                    editable={editing}
                    onTreeChange={editing ? (newTree: FamilyTree) => setEditedTree(newTree) : undefined}
                  />
                </div>
              ) : activeTab === "album" ? (
                <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-4 md:p-6">
                  <FamilyAlbum
                    tree={editing && editedTree ? editedTree : result.ipfsData.data}
                    editable={editing}
                    onTreeChange={editing ? (newTree: FamilyTree) => setEditedTree(newTree) : undefined}
                  />
                </div>
              ) : (
                <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-8 text-center">
                  <div className="text-4xl mb-3">💭</div>
                  <p className="text-[#5c3a2e] font-bold text-lg mb-2">回忆留言</p>
                  <p className="text-sm text-[#c4a67a]">
                    族人可在此留下对先人的追思与回忆，功能即将上线。
                  </p>
                </div>
              )}
            </section>
          </>
        ) : (
          // 老谱模式
          <div className="space-y-8">
            <LegacyContentView ipfsData={ipfsData} dataHash={result?.dataHash} />
          </div>
        )}

        {/* ====== 证书区域 ====== */}
        <section id="family-certificate-wrapper" className="mb-8">
          <FamilyCertificate
            familyName={familyName}
            familyId={familyId}
            timestamp={displayTimestamp}
          />
        </section>

        {/* ====== 邮箱备份 ====== */}
        <section id="email-backup-section" className="mb-8">
          <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-6">
            <h3 className="text-lg font-bold text-[#8b0000] mb-3 tracking-wider">
              📧 邮箱备份
            </h3>
            {emailSent ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-green-700 font-bold">
                  ✅ 备份请求已发送！请检查您的邮箱。
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-[#5c3a2e]/60 mb-3 leading-relaxed">
                  输入邮箱地址，我们将把这份族谱数据发送到您的邮箱，方便您永久保存。
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="请输入您的邮箱"
                    className="flex-1 px-4 py-2.5 border border-[#d4a76a]/40 rounded-xl text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                  />
                  <button
                    onClick={handleEmailBackup}
                    disabled={emailSending || !email.trim()}
                    className="px-6 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {emailSending ? "发送中..." : "发送"}
                  </button>
                </div>
                {emailError && (
                  <p className="text-xs text-red-500 mt-2">{emailError}</p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ====== 邀请编辑者（创作者和管理员可见） ====== */}
        {isCreator && (
          <section className="mb-8">
            <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 p-6">
              <h3 className="text-lg font-bold text-[#8b0000] mb-3 tracking-wider">
                👥 管理编辑者
              </h3>
              <p className="text-xs text-[#5c3a2e]/60 mb-3 leading-relaxed">
                您可以邀请族人共同编辑这份族谱。输入对方的注册邮箱即可授权。
              </p>

              {/* 邀请输入 */}
              <div className="flex gap-2 mb-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="输入对方注册邮箱"
                  className="flex-1 px-4 py-2.5 border border-[#d4a76a]/40 rounded-xl text-sm text-[#5c3a2e] focus:outline-none focus:border-[#8b0000] bg-[#fdfbf7]"
                />
                <button
                  onClick={handleInviteEditor}
                  disabled={inviteSending || !inviteEmail.trim()}
                  className="px-6 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {inviteSending ? "邀请中..." : "邀请"}
                </button>
              </div>

              {inviteError && (
                <p className="text-xs text-red-500 mb-2">{inviteError}</p>
              )}
              {inviteSuccess && (
                <p className="text-xs text-green-600 mb-2">{inviteSuccess}</p>
              )}

              {/* 当前编辑者列表 */}
              {editors.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-[#5c3a2e] mb-2">
                    当前编辑者（{editors.length} 人）
                  </p>
                  <div className="space-y-2">
                    {editors.map((editor) => (
                      <div
                        key={editor}
                        className="flex items-center justify-between px-3 py-2 bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/10"
                      >
                        <span className="text-sm text-[#5c3a2e]">{editor}</span>
                        <button
                          onClick={() => handleRemoveEditor(editor)}
                          disabled={removeSending && removeEditorHash === editor}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-40"
                        >
                          {removeSending && removeEditorHash === editor ? "移除中..." : "移除"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ====== 修订记录 ====== */}
        {result?.dataHash && (
          <section className="mb-8">
            <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/20 overflow-hidden">
              <RevisionHistory familyId={familyId} contractAddress="" />
            </div>
          </section>
        )}

        {/* ====== 数据详情 ====== */}
        <details className="mb-8 group">
          <summary className="cursor-pointer select-none text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors text-center mb-2">
            <span className="inline-flex items-center gap-1">
              📋 数据详情
              <svg className="w-3 h-3 group-open:rotate-180 transition-transform" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </summary>
          <div className="bg-[#fdfbf7]/80 rounded-2xl border border-[#d4a76a]/10 p-4">
            <div className="text-center space-y-1.5">
              {displayTimestamp && (
                <p className="text-xs text-[#c4a67a]">
                  🕒 首次存证时间：{displayTimestamp}
                </p>
              )}
              <p className="text-xs text-[#c4a67a]">
                🛡️ 数据基于区块链技术永久存证
              </p>
              {result?.dataHash && (
                <p className="text-[10px] text-[#c4a67a]/50 break-all font-mono select-all cursor-pointer">
                  IPFS: {result.dataHash}
                </p>
              )}
            </div>
          </div>
        </details>

        {/* ====== 关于数据安全 ====== */}
        <section className="mb-8">
          <div className="text-center text-xs text-[#c4a67a]/60 leading-relaxed">
            <p>• 所有数据存储在 IPFS 分布式网络，无法篡改</p>
            <p>• 每次编辑均创建不可逆修订记录</p>
            <p>• 建议定期邮箱备份，多重保障数据安全</p>
          </div>
        </section>
      </div>

      {/* ====== 海报弹窗 ====== */}
      {showPoster && treeData && (
        <FamilyPoster
          familyName={familyName}
          totalGenerations={totalGenerations}
          totalMembers={totalMembers}
          founderName={founderName}
          familyUrl={typeof window !== "undefined" ? window.location.href : ""}
          onClose={() => setShowPoster(false)}
        />
      )}
    </div>
  );
}
