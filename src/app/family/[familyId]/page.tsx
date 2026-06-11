"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import FamilyCertificate from "@/components/FamilyCertificate";
import { PagodaTreeView } from "@/components/FamilyTreePagoda";
import { FamilyTimeline } from "@/components/FamilyTimeline";
import RevisionHistory from "@/components/RevisionHistory";
import FamilyPoster from "@/components/FamilyPoster";
import { useAuth } from "@/lib/AuthContext";
import { FamilyAlbum } from "@/components/FamilyAlbum";
import { getImageUrls } from "@/lib/ipfsGateway";
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

// ==================== 主页面 ====================
export default function FamilyPage() {
  const params = useParams();
  const familyId = params.familyId as string;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedTree, setEditedTree] = useState<FamilyTree | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"tree" | "timeline" | "album">("tree");

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
    // 添加 noindex meta 标签
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
  }, []);

  // ---------- 智能判断数据类型（从 result 计算，在回调之前声明）----------
  const isStructuredTree =
    result?.ipfsData &&
    result.ipfsData.type === "family-tree" &&
    Array.isArray(result.ipfsData.data?.members);

  // ---------- 提取展示用数据（在回调之前声明）----------
  const ipfsData = result?.ipfsData;
  const familyName = isStructuredTree
    ? ipfsData?.data?.familyName || "家族族谱"
    : ipfsData?.familyName || "家族族谱";

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

    // 延迟一点点，让骨架屏先展示
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
      // API 返回新的 familyId，导航到新地址以展示最新数据
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

  // 收藏（localStorage 实现）
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

  // 下载证书（滚动到证书区域，由证书组件自带的保存按钮处理）
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
  // ---------- 海报计算 ----------
  const treeData = result?.ipfsData?.data;
  const totalMembers = treeData?.members?.length || 0;

  // 通过 parentId 推算代数层级（根节点代数=1）
  const totalGenerations = (() => {
    const members = treeData?.members;
    if (!members || members.length === 0) return 1;
    // 找没有 parentId 的根节点（代数=1）
    const parentIds = new Set(members.map((m) => m.parentId).filter(Boolean));
    const roots = members.filter((m) => !m.parentId);
    // 计算每个人的代级（BFS/拓扑排序）
    const genMap: Record<string, number> = {};
    const queue: { id: string; gen: number }[] = roots.map((r) => ({ id: r.id, gen: 1 }));
    let maxGen = 1;
    while (queue.length > 0) {
      const { id, gen } = queue.shift()!;
      genMap[id] = gen;
      maxGen = Math.max(maxGen, gen);
      const children = members.filter((m) => m.parentId === id);
      for (const child of children) {
        queue.push({ id: child.id, gen: gen + 1 });
      }
    }
    return maxGen;
  })();

  // 找始祖（没有 parentId 的第一个成员）
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

  // ---------- 加载中 ----------
  if (loading) return <LoadingSkeleton />;

  // ---------- 错误 ----------
  if (error) return <ErrorView message={error} />;

  // ---------- 没有数据 ----------
  if (!ipfsData) {
    return (
      <div className="min-h-screen bg-[#f5f0e8]">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <ErrorView message={result?.warning || "无法获取数据"} />
        </div>
      </div>
    );
  }

  // ========== 渲染 ==========
  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      {/* 顶部导航 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-[#d4a76a]/20">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="text-[#8b0000] font-black text-xl tracking-widest hover:opacity-80 transition-opacity"
          >
            云族谱
          </Link>
          <Link
            href="/"
            className="text-sm text-[#5c3a2e] hover:text-[#8b0000] transition-colors"
          >
            ← 返回首页
          </Link>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-10">
        {/* ---------- 证书 ---------- */}
        <section id="family-certificate-wrapper">
          <FamilyCertificate
            familyName={familyName}
            familyId={familyId}
            txHash={undefined}
            ipfsCID={result?.dataHash}
            timestamp={displayTimestamp}
          />
        </section>

        {/* ---------- 备份引导：收藏、复制链接、分享、下载证书 ---------- */}
        <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
          <h2 className="text-xl font-bold text-[#8b0000] mb-4 tracking-wider text-center">
            📌 保存本谱
          </h2>
          <p className="text-sm text-[#5c3a2e] text-center mb-6">
            族谱是家族的根脉传承，请妥善保存，以备后世查阅
          </p>

          {/* 五个按钮 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {/* 收藏 */}
            <button
              onClick={handleFavorite}
              className={`flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border transition-all duration-200 active:scale-95 ${
                favorited
                  ? "bg-[#8b0000]/10 border-[#8b0000] text-[#8b0000]"
                  : "bg-[#fdfbf7] border-[#d4a76a]/30 text-[#5c3a2e] hover:border-[#8b0000]/40 hover:bg-[#8b0000]/5"
              }`}
            >
              <span className="text-2xl">{favorited ? "❤️" : "🤍"}</span>
              <span className="text-xs font-bold tracking-wider">
                {favorited ? "已收藏" : "收藏本谱"}
              </span>
            </button>

            {/* 复制链接 */}
            <button
              onClick={handleCopyLink}
              className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] text-[#5c3a2e] hover:border-[#8b0000]/40 hover:bg-[#8b0000]/5 transition-all duration-200 active:scale-95"
            >
              <span className="text-2xl">🔗</span>
              <span className="text-xs font-bold tracking-wider">
                {copied ? "已复制 ✓" : "复制链接"}
              </span>
            </button>

            {/* 分享 */}
            <button
              onClick={handleShare}
              className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] text-[#5c3a2e] hover:border-[#8b0000]/40 hover:bg-[#8b0000]/5 transition-all duration-200 active:scale-95"
            >
              <span className="text-2xl">📤</span>
              <span className="text-xs font-bold tracking-wider">分享给族人</span>
            </button>

            {/* 下载证书 */}
            <button
              onClick={handleDownloadCert}
              className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] text-[#5c3a2e] hover:border-[#8b0000]/40 hover:bg-[#8b0000]/5 transition-all duration-200 active:scale-95"
            >
              <span className="text-2xl">📄</span>
              <span className="text-xs font-bold tracking-wider">下载证书</span>
            </button>

            {/* 生成海报 */}
            <button
              onClick={() => setShowPoster(true)}
              className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] text-[#5c3a2e] hover:border-[#8b0000]/40 hover:bg-[#8b0000]/5 transition-all duration-200 active:scale-95"
            >
              <span className="text-2xl">🖼️</span>
              <span className="text-xs font-bold tracking-wider">生成海报</span>
            </button>
          </div>

          {/* 引导说明 */}
          <div className="mt-5 p-4 bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/20">
            <p className="text-xs text-[#c4a67a] leading-relaxed">
              💡 <strong>温馨提示：</strong>
              收藏本谱可快速在首页查阅；分享链接给族人共同完善；下载证书图片留存纪念。
            </p>
          </div>
        </section>

        {/* ---------- 邮箱备份 ---------- */}
        <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
          <h2 className="text-xl font-bold text-[#8b0000] mb-4 tracking-wider text-center">
            📧 邮箱备份
          </h2>
          <p className="text-sm text-[#5c3a2e] text-center mb-5">
            将本谱链接发送至您的邮箱，方便日后查找
          </p>

          {emailSent ? (
            <div className="text-center py-4">
              <span className="text-4xl">✅</span>
              <p className="text-[#5c3a2e] font-bold mt-2">发送成功！</p>
              <p className="text-xs text-[#c4a67a] mt-1">
                请查收邮箱中的备份邮件
              </p>
              <button
                onClick={() => { setEmailSent(false); setEmail(""); }}
                className="mt-3 text-sm text-[#8b0000] underline hover:text-[#a52a2a]"
              >
                发送到其他邮箱
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
                placeholder="请输入您的邮箱地址"
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#d4a76a]/40 bg-[#fdfbf7] text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000] transition-all text-sm"
                disabled={emailSending}
              />
              <button
                onClick={handleEmailBackup}
                disabled={emailSending || !email.trim()}
                className="px-6 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-[#8b0000]/20"
              >
                {emailSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    发送中...
                  </>
                ) : (
                  "💌 发送"
                )}
              </button>
            </div>
          )}

          {emailError && (
            <p className="mt-2 text-sm text-red-500">{emailError}</p>
          )}
        </section>

        {/* ---------- 编辑/保存按钮（仅创建者和编辑者可见） ---------- */}
        {isStructuredTree && !loading && settingsLoaded && canEdit && (
          <section className="flex justify-end gap-3">
            {editing ? (
              <>
                <button
                  onClick={handleSaveRevision}
                  disabled={saving}
                  className="px-5 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 flex items-center gap-2 shadow-lg shadow-[#8b0000]/20"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      保存中...
                    </>
                  ) : (
                    "💾 保存修订"
                  )}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditedTree(null);
                  }}
                  disabled={saving}
                  className="px-5 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors disabled:opacity-40"
                >
                  取消编辑
                </button>
              </>
            ) : (
              <button
                onClick={enterEditMode}
                className="px-5 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors shadow-lg shadow-[#8b0000]/20 flex items-center gap-2"
              >
                ✏️ 编辑宗谱
              </button>
            )}
          </section>
        )}

        {/* ---------- 邀请编辑者（仅创建者可见） ---------- */}
        {settingsLoaded && isCreator && (
          <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
            <h2 className="text-xl font-bold text-[#8b0000] mb-4 tracking-wider text-center">
              👥 管理编辑者
            </h2>
            <p className="text-sm text-[#5c3a2e] text-center mb-6">
              邀请其他族人共同编辑本谱
            </p>

            {/* 当前编辑者列表 */}
            {editors.length > 0 && (
              <div className="mb-5 space-y-2">
                <p className="text-xs font-bold text-[#5c3a2e] tracking-wider">当前编辑者：</p>
                {editors.map((hash) => (
                  <div
                    key={hash}
                    className="flex items-center justify-between bg-[#fdfbf7] rounded-xl px-4 py-2 border border-[#d4a76a]/20"
                  >
                    <span className="text-xs font-mono text-[#5c3a2e] truncate flex-1">
                      {hash.slice(0, 12)}...{hash.slice(-6)}
                    </span>
                    <button
                      onClick={() => handleRemoveEditor(hash)}
                      disabled={removeSending && removeEditorHash === hash}
                      className="ml-2 px-3 py-1 text-xs font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40 flex items-center gap-1"
                    >
                      {removeSending && removeEditorHash === hash ? (
                        <div className="w-3 h-3 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                      ) : (
                        "移除"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 邀请输入框 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(null); }}
                placeholder="输入对方邮箱地址"
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#d4a76a]/40 bg-[#fdfbf7] text-[#5c3a2e] placeholder-[#c4a67a] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000] transition-all text-sm"
                disabled={inviteSending}
              />
              <button
                onClick={handleInviteEditor}
                disabled={inviteSending || !inviteEmail.trim()}
                className="px-6 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-[#8b0000]/20"
              >
                {inviteSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    邀请中...
                  </>
                ) : (
                  "📨 邀请"
                )}
              </button>
            </div>

            {inviteError && (
              <p className="mt-2 text-sm text-red-500">{inviteError}</p>
            )}
            {inviteSuccess && (
              <p className="mt-2 text-sm text-green-600">{inviteSuccess}</p>
            )}
          </section>
        )}

        {/* ---------- 标签切换：树状图 / 时间轴 ---------- */}
        {isStructuredTree && result.ipfsData?.data ? (
          <>
            {/* 标签按钮 */}
            <div className="flex justify-center gap-2 mb-6">
              <button
                onClick={() => setActiveTab("tree")}
                className={`px-6 py-2.5 rounded-xl font-bold text-sm tracking-wider transition-all duration-200 ${
                  activeTab === "tree"
                    ? "bg-[#8b0000] text-white shadow-lg shadow-[#8b0000]/20"
                    : "bg-white text-[#5c3a2e] border border-[#d4a76a]/30 hover:border-[#8b0000]/40 hover:bg-[#fdfbf7]"
                }`}
              >
                🌳 家族树
              </button>
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
            </div>

            {/* 条件渲染 */}
            {activeTab === "tree" ? (
              <PagodaTreeView
                tree={editing && editedTree ? editedTree : result.ipfsData.data}
                editable={editing}
                onTreeChange={editing ? (newTree) => setEditedTree(newTree) : undefined}
                onRequestEdit={enterEditMode}
              />
            ) : activeTab === "timeline" ? (
              <FamilyTimeline
                tree={editing && editedTree ? editedTree : result.ipfsData.data}
                editable={editing}
                onTreeChange={editing ? (newTree) => setEditedTree(newTree) : undefined}
              />
            ) : (
              <FamilyAlbum
                tree={editing && editedTree ? editedTree : result.ipfsData.data}
                editable={editing}
                onTreeChange={editing ? (newTree) => setEditedTree(newTree) : undefined}
              />
            )}
          </>
        ) : (
          <LegacyContentView ipfsData={ipfsData} dataHash={result?.dataHash} />
        )}

        {/* ---------- 修订记录 ---------- */}
        {isStructuredTree && (
          <RevisionHistory
            familyId={familyId}
            contractAddress={process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0x9a943CfC5bde0EA506b2A88E5AF653d74C6D06ea"}
          />
        )}

        {/* ---------- 数据详情 ---------- */}
        <section className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-8">
          <h2 className="text-xl font-bold text-[#8b0000] mb-6 tracking-wider">
            数据详情
          </h2>

          <div className="space-y-4">
            {/* 数据类型 */}
            <DataRow label="数据类型">
              {isStructuredTree ? "结构化家族树" : "老谱影像"}
            </DataRow>

            {/* 家族ID（完整） */}
            <DataRow label="家族 ID" mono>
              {familyId}
            </DataRow>

            {/* 数据标识 */}
            {result?.dataHash && (
              <DataRow label="数据标识" mono>
                {result.dataHash}
              </DataRow>
            )}

            {/* 数据查看链接 */}
            {result?.dataHash && (
              <DataRow label="数据网关">
                <a
                  href={`https://w3s.link/ipfs/${result.dataHash}/metadata.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8b0000] underline hover:text-[#a52a2a]"
                >
                  查看原始数据
                </a>
              </DataRow>
            )}

            {/* 成员数（结构化树） */}
            {isStructuredTree && result.ipfsData?.data && (
              <DataRow label="族人数量">
                {result.ipfsData.data.members.length} 人
              </DataRow>
            )}

            {/* 图片数量（老谱模式） */}
            {!isStructuredTree && ipfsData?.imageCount !== undefined && (
              <DataRow label="上传图片数">
                {ipfsData.imageCount} 张
              </DataRow>
            )}
          </div>
        </section>

        {/* ---------- 关于数据安全 ---------- */}
        <section className="bg-[#fdfbf7] rounded-2xl border border-[#d4a76a]/20 p-6">
          <h3 className="text-sm font-bold text-[#5c3a2e] mb-2 tracking-wider">
            💡 关于数据保存
          </h3>
          <p className="text-xs text-[#c4a67a] leading-relaxed">
            数据一旦保存，将被永久记录且不可篡改。原始文件存储在分布式网络中，只要至少有一个节点保留数据，即可从网络中的任何地方访问。
          </p>
          {result?.warning && (
            <p className="text-xs text-amber-600 mt-2">{result.warning}</p>
          )}
        </section>
      </div>

      {/* ---------- 海报模态框 ---------- */}
      {showPoster && (
        <FamilyPoster
          familyName={familyName}
          totalGenerations={totalGenerations}
          totalMembers={totalMembers}
          founderName={founderName}
          description={treeData?.members?.find((m) => !m.parentId)?.story || treeData?.familyEvents?.[0]?.description}
          familyUrl={typeof window !== "undefined" ? window.location.href : ""}
          onClose={() => setShowPoster(false)}
        />
      )}
    </div>
  );
}

// ---------- 数据行组件 ----------
function DataRow({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
      <span className="flex-shrink-0 text-sm font-bold text-[#5c3a2e] w-24">
        {label}
      </span>
      <span
        className={`text-sm text-[#5c3a2e] break-all ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {children}
      </span>
    </div>
  );
}