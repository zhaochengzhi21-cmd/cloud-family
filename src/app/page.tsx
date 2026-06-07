"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Member } from "@/types/family";
import { useAuth } from "@/lib/AuthContext";
import LoginModal from "@/components/LoginModal";
import FeedbackModal from "@/components/FeedbackModal";

// ---------- 类型定义 ----------
interface UploadState {
  status: "idle" | "uploading" | "success" | "error";
  progress: number;
  message: string;
}

interface ApiResponse {
  success: boolean;
  familyId?: string;
  txHash?: string;
  viewUrl?: string;
  ipfsCID?: string;
  error?: string;
}

interface ParsedMember {
  tempId: string;
  name: string;
  gender?: string;
  birth?: string;
  death?: string;
  relation?: string;
  confirmed: boolean;
  skipped: boolean;
}

type OcrStatus = "idle" | "uploading" | "ocr_parsing" | "reviewing" | "error";

// ---------- 实用函数 ----------
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateTempId(): string {
  return "temp_" + generateId();
}

// ====================================================================
// 老谱 OCR 识别组件（上传图片 → OCR → AI 解析 → 确认 → 自动保存）
// ====================================================================
function OcrUploadButton() {
  const router = useRouter();
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [ocrRawText, setOcrRawText] = useState("");
  const [isPublicOcr, setIsPublicOcr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelOcr = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setParsedMembers([]);
    setOcrRawText("");
    setErrorMsg("");
    setStatus("idle");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsedMembers([]);
    setErrorMsg("");
    setOcrRawText("");
    setStatus("uploading");
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload-photo", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => null);
        throw new Error(errData?.error || `上传失败 (${uploadRes.status})`);
      }
      const uploadData = await uploadRes.json();
      const imageUrl = uploadData.ipfsUrl;
      setStatus("ocr_parsing");
      const ocrRes = await fetch("/api/ocr-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
        signal: controller.signal,
      });
      if (!ocrRes.ok) {
        const errData = await ocrRes.json().catch(() => null);
        throw new Error(errData?.error || `OCR 解析失败 (${ocrRes.status})`);
      }
      const ocrData = await ocrRes.json();
      const membersList = ocrData.members || [];
      if (membersList.length === 0) {
        setErrorMsg(ocrData.message || "未能从图片中识别出家谱成员");
        setOcrRawText(ocrData.ocrText || "");
        setStatus("error");
        return;
      }
      const parsed = membersList.map((m: any) => ({
        tempId: generateTempId(),
        name: m.name || "未知",
        gender: m.gender || "",
        birth: m.birth ? String(m.birth) : "",
        death: m.death ? String(m.death) : "",
        relation: m.relation || "",
        confirmed: false,
        skipped: false,
      }));
      setParsedMembers(parsed);
      setOcrRawText(ocrData.ocrText || "");
      setStatus("reviewing");
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.name === "CanceledError") return;
      console.error("OCR upload error:", err);
      setErrorMsg(err.message || "处理失败，请重试");
      setStatus("error");
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleConfirm = useCallback((tempId: string) => {
    setParsedMembers((prev) =>
      prev.map((m) => (m.tempId === tempId ? { ...m, confirmed: true, skipped: false } : m))
    );
  }, []);

  const handleSkip = useCallback((tempId: string) => {
    setParsedMembers((prev) =>
      prev.map((m) => (m.tempId === tempId ? { ...m, skipped: true, confirmed: false } : m))
    );
  }, []);

  const handleImport = useCallback(async () => {
    const confirmed = parsedMembers.filter((m) => m.confirmed);
    if (confirmed.length === 0) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const members: Member[] = confirmed.map((m) => ({
        id: generateId(),
        name: m.name,
        gender: (m.gender as "男" | "女") || undefined,
        birth: m.birth || undefined,
        death: m.death || undefined,
      }));
      const response = await fetch("/api/save-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: "老谱 " + (confirmed[0]?.name || "家族"),
          members,
          searchable: isPublicOcr,
        }),
      });
      const result: ApiResponse = await response.json();
      if (!result.success || !result.familyId) {
        throw new Error(result.error || "保存失败");
      }
      setParsedMembers([]);
      setOcrRawText("");
      setSaving(false);
      setStatus("idle");
      setErrorMsg("");
      router.push(`/family/${result.familyId}`);
    } catch (err: any) {
      console.error("Auto-save error:", err);
      setErrorMsg(err.message || "自动保存家族树失败，请重试");
      setSaving(false);
      setStatus("reviewing");
    }
  }, [parsedMembers, router, isPublicOcr]);

  const handleReset = useCallback(() => {
    setParsedMembers([]);
    setOcrRawText("");
    setStatus("idle");
    setErrorMsg("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div className="w-full space-y-3">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
      {status === "idle" && (
        <div className="flex flex-col items-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full max-w-xs py-4 rounded-2xl bg-gradient-to-r from-[#5c3a2e] to-[#7a4e3a] text-white font-bold text-base tracking-wider hover:shadow-xl hover:scale-[1.02] active:scale-[0.97] transition-all duration-200 flex items-center justify-center gap-2"
          >
            <span className="text-2xl">📜</span>
            <span>上传老谱识别</span>
          </button>
          <p className="text-xs text-[#5c3a2e]/40 mt-2">上传老族谱照片，自动识别并提取家族成员</p>
        </div>
      )}
      {status === "uploading" && (
        <div className="bg-white rounded-xl border border-[#d4a76a]/30 p-6 text-center">
          <div className="w-10 h-10 border-3 border-[#d4a76a]/30 border-t-[#5c3a2e] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#5c3a2e]/70">正在上传图片到 IPFS…</p>
          <button onClick={handleCancelOcr} className="mt-4 px-4 py-2 text-sm rounded-xl border-2 border-[#d4a76a]/50 text-[#5c3a2e] hover:bg-[#f5f0e8] transition-all">取消</button>
        </div>
      )}
      {status === "ocr_parsing" && (
        <div className="bg-white rounded-xl border border-[#d4a76a]/30 p-6 text-center">
          <div className="w-10 h-10 border-3 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#5c3a2e]/70">正在识别老谱文字并解析成员…</p>
          <p className="text-xs text-[#c4a67a] mt-2">此过程可能需要 10-30 秒</p>
          <button onClick={handleCancelOcr} className="mt-3 px-4 py-2 text-sm rounded-xl border-2 border-[#d4a76a]/50 text-[#5c3a2e] hover:bg-[#f5f0e8] transition-all">取消</button>
        </div>
      )}
      {status === "error" && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm text-red-700 text-center mb-2">{errorMsg}</p>
          {ocrRawText && (
            <details className="mt-2">
              <summary className="text-xs text-red-500/70 cursor-pointer hover:text-red-600">查看 OCR 原始文字</summary>
              <p className="text-xs text-red-600/60 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">{ocrRawText}</p>
            </details>
          )}
          <div className="flex justify-center gap-3 mt-3">
            <button onClick={handleReset} className="px-4 py-2 text-sm rounded-xl border-2 border-[#d4a76a]/50 text-[#5c3a2e] hover:bg-[#f5f0e8] transition-all">重新选择</button>
          </div>
        </div>
      )}
      {status === "reviewing" && parsedMembers.length > 0 && (
        <div className="bg-[#fdfbf7] border-2 border-[#d4a76a]/30 rounded-2xl p-4">
          <div className="text-center mb-3">
            <p className="text-sm font-bold text-[#8b0000] tracking-wider">📜 AI 识别老谱结果，请逐条核对确认后再生成</p>
          </div>
          <div className="space-y-2 mb-3">
            {parsedMembers.map((member) => (
              <div key={member.tempId} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${member.confirmed ? "bg-green-50 border-green-300" : member.skipped ? "bg-gray-50 border-gray-200 opacity-50" : "bg-white border-[#d4a76a]/30 hover:border-[#8b0000]/30"}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0 ${member.gender === "女" ? "bg-pink-100 text-pink-600" : member.gender === "男" ? "bg-blue-100 text-blue-600" : "bg-[#f5f0e8] text-[#5c3a2e]"}`}>{member.name.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[#5c3a2e]">{member.name}</span>
                    {member.birth && <span className="text-xs text-[#c4a67a]">生于 {member.birth}</span>}
                    {member.death && <span className="text-xs text-[#c4a67a]">卒于 {member.death}</span>}
                    {member.gender && <span className="text-xs text-[#c4a67a]">{member.gender}</span>}
                  </div>
                  {member.relation && <p className="text-xs text-[#5c3a2e]/60 mt-0.5">关系：{member.relation}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {member.confirmed ? (
                    <span className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg font-bold">✓ 已确认</span>
                  ) : member.skipped ? (
                    <span className="px-3 py-1 text-xs bg-gray-100 text-gray-400 rounded-lg">已跳过</span>
                  ) : (
                    <>
                      <button onClick={() => handleConfirm(member.tempId)} className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">✓ 确认</button>
                      <button onClick={() => handleSkip(member.tempId)} className="px-3 py-1 text-xs bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors">✗ 跳过</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mb-3 bg-white rounded-xl border border-[#d4a76a]/20 p-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-3">
                <label className="text-xs font-bold text-[#5c3a2e] flex items-center gap-1.5">
                  <span>🔍</span>
                  <span>允许他人通过家族名搜索到此家族</span>
                </label>
              </div>
              <button type="button" role="switch" aria-checked={isPublicOcr} onClick={() => setIsPublicOcr((prev) => !prev)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 ${isPublicOcr ? "bg-[#8b0000]" : "bg-gray-200"}`}
              >
                <span aria-hidden="true" className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isPublicOcr ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#5c3a2e]/60">已确认 {parsedMembers.filter((m) => m.confirmed).length} / 共 {parsedMembers.length} 条</p>
            <div className="flex gap-3">
              <button onClick={handleReset} className="px-4 py-2 text-sm rounded-xl border-2 border-[#d4a76a]/50 text-[#5c3a2e] hover:bg-[#f5f0e8] transition-all">重新选择</button>
              <button onClick={handleImport} disabled={parsedMembers.filter((m) => m.confirmed).length === 0}
                className={`px-6 py-2 text-sm rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {saving ? (
                  <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />保存中…</span>
                ) : (
                  <span>📥 生成家族树（{parsedMembers.filter((m) => m.confirmed).length}）</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RecentFamily {
  id: string;
  name: string;
  memberCount: number;
  updatedAt: string;
}

export default function HomePage() {
  const router = useRouter();
  const { isLoggedIn, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"create-tree" | "ocr" | null>(null);
  const [recentFamilies, setRecentFamilies] = useState<RecentFamily[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    async function fetchRecent() {
      try {
        const res = await fetch("/api/search-family?recent=true&limit=6");
        const data = await res.json();
        if (data.success && Array.isArray(data.families)) {
          setRecentFamilies(data.families.slice(0, 6));
        } else {
          setRecentFamilies([]);
        }
      } catch {
        setRecentFamilies([]);
      } finally {
        setRecentLoading(false);
      }
    }
    fetchRecent();
  }, []);

  const handleRequireLogin = useCallback((action: "create-tree" | "ocr") => {
    if (isLoggedIn) {
      if (action === "create-tree") router.push("/create-tree");
    } else {
      setPendingAction(action);
      setShowLoginModal(true);
    }
  }, [isLoggedIn, router]);

  const handleLoginSuccess = useCallback(() => {
    if (pendingAction === "create-tree") router.push("/create-tree");
    setPendingAction(null);
  }, [pendingAction, router]);

  useEffect(() => {
    const canvas = document.getElementById("bg-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles: { x: number; y: number; r: number; dx: number; dy: number; alpha: number }[] = [];
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 1,
        dx: (Math.random() - 0.5) * 0.3,
        dy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.3 + 0.1,
      });
    }
    let animId: number;
    function animate() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(139, 0, 0, ${p.alpha})`;
        ctx.fill();
      });
      animId = requestAnimationFrame(animate);
    }
    animate();
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f5f0e8]">
      <canvas id="bg-canvas" className="absolute inset-0 pointer-events-none opacity-40" />
      <div className="relative z-10">
        <div className="h-1 bg-gradient-to-r from-[#8b0000] via-[#ffd700] to-[#8b0000]" />
      </div>
      <div className="relative z-10 flex flex-col items-center min-h-screen px-4 py-12">
        <div className="absolute top-20 left-0 right-0 flex justify-center pointer-events-none opacity-10">
          <svg width="1200" height="60" viewBox="0 0 1200 60" fill="none">
            <path d="M0 30 Q150 0 300 30 Q450 60 600 30 Q750 0 900 30 Q1050 60 1200 30" stroke="#8b0000" strokeWidth="2" />
          </svg>
        </div>
        <div className="w-full max-w-5xl bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-[#d4a76a]/30 p-8 md:p-12">
          <div className="flex items-center justify-end gap-3 mb-6">
            {isLoggedIn ? (
              <>
                <a href="/my-families" className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#8b0000]/10 text-[#8b0000] font-bold text-sm hover:bg-[#8b0000]/20 transition-all">
                  <span>🏠</span><span>我的家族</span>
                </a>
                <button onClick={logout} className="px-4 py-2 rounded-xl border-2 border-[#d4a76a]/50 text-[#5c3a2e] font-bold text-sm hover:bg-[#f5f0e8] transition-all">退出登录</button>
              </>
            ) : (
              <button onClick={() => setShowLoginModal(true)} className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm hover:shadow-lg transition-all">登录</button>
            )}
          </div>
          <div className="text-center mb-6">
            <h1 className="text-5xl md:text-6xl font-black text-[#8b0000] tracking-widest mb-3">
              云族谱 <span className="text-[#ffd700]">·</span> <span className="text-[#8b0000]">永传</span>
            </h1>
            <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mb-4" />
            <p className="text-lg md:text-xl text-[#5c3a2e] leading-relaxed">永久免费，让每一份家谱在数字世界永存</p>
          </div>
          <div className="text-center mb-8">
            <p className="text-base md:text-lg text-[#5c3a2e]/80 font-medium tracking-wider">选择以下方式开始保存家族记忆</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="block group">
              <div className="h-full bg-gradient-to-br from-[#fdfbf7] to-[#f5f0e8] border-2 border-[#d4a76a]/50 rounded-2xl p-6 md:p-8 text-center hover:border-[#8b0000]/50 hover:shadow-xl hover:from-[#fff] hover:to-[#fdfbf7] transition-all duration-300 flex flex-col items-center justify-between">
                <div className="w-full">
                  <div className="text-5xl md:text-6xl mb-4">📜</div>
                  <h3 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider mb-3 group-hover:text-[#a52a2a] transition-colors">上传老谱识别</h3>
                  <p className="text-sm md:text-base text-[#5c3a2e]/70 mb-5 leading-relaxed">上传老族谱照片，自动识别并提取家族成员</p>
                </div>
                {isLoggedIn ? (
                  <div className="w-full"><OcrUploadButton /></div>
                ) : (
                  <button onClick={() => { setPendingAction("ocr"); setShowLoginModal(true); }} className="w-full py-3 md:py-4 rounded-2xl bg-gradient-to-r from-[#5c3a2e] to-[#7a4e3a] text-white font-bold text-sm md:text-base tracking-wider hover:shadow-xl hover:scale-[1.02] active:scale-[0.97] transition-all duration-200">上传识别 →</button>
                )}
              </div>
            </div>
            <button onClick={() => handleRequireLogin("create-tree")} className="block group cursor-pointer">
              <div className="h-full bg-gradient-to-br from-[#fdfbf7] to-[#f5f0e8] border-2 border-[#d4a76a]/50 rounded-2xl p-6 md:p-8 text-center hover:border-[#8b0000]/50 hover:shadow-xl hover:from-[#fff] hover:to-[#fdfbf7] transition-all duration-300 flex flex-col items-center justify-between">
                <div>
                  <div className="text-5xl md:text-6xl mb-4">🌱</div>
                  <h3 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider mb-3 group-hover:text-[#a52a2a] transition-colors">从零创建</h3>
                  <p className="text-sm md:text-base text-[#5c3a2e]/70 mb-5 leading-relaxed">从零开始手动创建家族树谱系</p>
                </div>
                <div className="w-full py-3 md:py-4 rounded-2xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm md:text-base tracking-wider hover:shadow-xl hover:scale-[1.02] active:scale-[0.97] transition-all duration-200">开始创建 →</div>
              </div>
            </button>
            <a href="/search" className="block group">
              <div className="h-full bg-gradient-to-br from-[#fdfbf7] to-[#f5f0e8] border-2 border-[#d4a76a]/50 rounded-2xl p-6 md:p-8 text-center hover:border-[#8b0000]/50 hover:shadow-xl hover:from-[#fff] hover:to-[#fdfbf7] transition-all duration-300 flex flex-col items-center justify-between">
                <div>
                  <div className="text-5xl md:text-6xl mb-4">🔍</div>
                  <h3 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider mb-3 group-hover:text-[#a52a2a] transition-colors">查找已有家族</h3>
                  <p className="text-sm md:text-base text-[#5c3a2e]/70 mb-5 leading-relaxed">输入家族名称，查找已存证的家谱</p>
                </div>
                <div className="w-full py-3 md:py-4 rounded-2xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm md:text-base tracking-wider hover:shadow-xl hover:scale-[1.02] active:scale-[0.97] transition-all duration-200">开始查找 →</div>
              </div>
            </a>
          </div>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#d4a76a]/30" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 bg-white/90 text-[#c4a67a] text-sm font-bold tracking-widest">或 &nbsp; 直接上传家谱文件</span>
            </div>
          </div>
          <div className="mb-6">
            <div className="relative cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300 border-[#d4a76a]/50 bg-[#fdfbf7] hover:border-[#8b0000]/50 hover:bg-[#8b0000]/5">
              <p className="text-[#8b0000] font-medium flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                点击或拖拽上传家谱文件（JPG、PNG、PDF）
              </p>
            </div>
          </div>
        </div>

        {/* 最近更新的家族 */}
        <div className="w-full max-w-5xl mt-8">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg md:text-xl font-black text-[#8b0000] tracking-wider flex items-center gap-2">
                <span>🕯️</span><span>最近更新的家族</span>
              </h2>
              <a href="/search" className="text-sm text-[#c4a67a] hover:text-[#8b0000] transition-colors">查看全部 →</a>
            </div>
            {recentLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-3 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin" />
              </div>
            ) : recentFamilies.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {recentFamilies.map((family) => (
                  <a key={family.id} href={`/family/${family.id}`} className="block group">
                    <div className="bg-gradient-to-br from-[#fdfbf7] to-[#f5f0e8] border border-[#d4a76a]/30 rounded-xl p-4 hover:border-[#8b0000]/50 hover:shadow-md transition-all duration-200">
                      <h3 className="font-bold text-[#5c3a2e] group-hover:text-[#8b0000] transition-colors truncate">{family.name}</h3>
                      <div className="flex items-center gap-3 mt-2 text-xs text-[#c4a67a]">
                        <span>{family.memberCount} 位成员</span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-[#c4a67a] text-sm">暂无家族数据，立即创建第一个家族吧</p>
                <button onClick={() => handleRequireLogin("create-tree")} className="mt-4 px-6 py-2 rounded-xl bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white font-bold text-sm hover:shadow-lg transition-all">开始创建</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="w-full max-w-5xl mt-8">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-[#d4a76a]/20 px-6 py-4 flex items-center justify-between">
            <p className="text-xs text-[#c4a67a] tracking-wider">云族谱 · 永久免费 · 让家谱永存</p>
            <button
              onClick={() => setShowFeedbackModal(true)}
              className="text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors flex items-center gap-1"
            >
              <span>💬</span>
              <span>意见反馈</span>
            </button>
          </div>
        </footer>
      </div>

      <LoginModal
        open={showLoginModal}
        onClose={() => { setShowLoginModal(false); setPendingAction(null); }}
        onSuccess={handleLoginSuccess}
      />
      <FeedbackModal
        open={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
      />
    </div>
  );
}