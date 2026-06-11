"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Member } from "@/types/family";
import { useAuth } from "@/lib/AuthContext";

// ====================================================================
// 类型定义
// ====================================================================
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

interface MemberFormProps {
  members: Member[];
  editingMember: Member | null;
  onConfirm: (member: Member) => void;
  onCancel: () => void;
}

interface DateOption {
  label: string;
  value: string;
}

// ====================================================================
// 工具函数
// ====================================================================
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateTempId(): string {
  return "temp_" + generateId();
}

const currentYear = new Date().getFullYear();
const maxYear = currentYear + 5;
const YEAR_OPTIONS: DateOption[] = [
  { label: "未知", value: "" },
  ...Array.from({ length: maxYear - 1900 + 1 }, (_, i) => ({
    label: String(1900 + i),
    value: String(1900 + i),
  })),
];

const MONTH_OPTIONS: DateOption[] = [
  { label: "未知", value: "" },
  ...Array.from({ length: 12 }, (_, i) => ({
    label: String(i + 1),
    value: String(i + 1),
  })),
];

const DAY_OPTIONS: DateOption[] = [
  { label: "未知", value: "" },
  ...Array.from({ length: 31 }, (_, i) => ({
    label: String(i + 1),
    value: String(i + 1),
  })),
];

// ====================================================================
// AI 解析语音文本 → 提取家族成员
// ====================================================================
async function parseTextToMembers(text: string): Promise<ParsedMember[]> {
  try {
    const res = await fetch("/api/generate-biography", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.members && Array.isArray(data.members)) {
      return data.members.map((m: any) => ({
        tempId: generateTempId(),
        name: m.name || "未知",
        gender: m.gender || "",
        birth: m.birth ? String(m.birth) : "",
        relation: m.relation || "",
        confirmed: false,
        skipped: false,
      }));
    }
    // fallback: 尝试从 biography 文本解析
    const biography: string = data.biography || "";
    if (biography) {
      const lines = biography.split("\n").filter(Boolean);
      const fallback: ParsedMember[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        const tmpName = trimmed.replace(/^[0-9]+[.、\s]*/, "").split(/[，,、]/)[0] || trimmed;
        if (tmpName.length > 0 && tmpName.length <= 10) {
          fallback.push({
            tempId: generateTempId(),
            name: tmpName,
            gender: "",
            birth: "",
            relation: "",
            confirmed: false,
            skipped: false,
          });
        }
      }
      return fallback;
    }
    return [];
  } catch (err: any) {
    console.error("AI parse error:", err);
    throw err;
  }
}

// ====================================================================
// 语音听写组件（微信"按住说话"风格）
// ====================================================================
type Status = "idle" | "listening" | "processing" | "reviewing" | "error";

function VoiceRecordButton({ onMembersReady }: { onMembersReady: (members: Member[]) => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isPressedRef = useRef(false);

  // 延迟到客户端挂载后再判断浏览器是否支持语音识别，避免 Hydration 不匹配
  useEffect(() => {
    setMounted(true);
  }, []);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // ---------- 开始录音 ----------
  const startRecording = useCallback(async () => {
    if (status === "processing" || status === "reviewing") return;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setErrorMsg("您的浏览器不支持语音识别，请使用 Chrome 浏览器或手动录入。");
      setStatus("error");
      return;
    }

    // 显式请求麦克风权限，避免浏览器静默拒绝
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      console.error("麦克风权限被拒绝:", err);
      setErrorMsg("请在浏览器设置中允许麦克风权限。");
      setStatus("error");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) {
        setTranscript((prev) => prev + final);
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      console.error("语音识别错误:", event.error);
      if (event.error === "no-speech") return;
      if (event.error === "not-allowed") {
        setErrorMsg("请在浏览器设置中允许麦克风权限。");
      } else {
        setErrorMsg(`语音识别出错: ${event.error}`);
      }
      setStatus("error");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
    setErrorMsg("");
  }, [status]);

  // ---------- 停止录音 ----------
  const stopRecording = useCallback(() => {
    if (status === "listening") {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setStatus("processing");
    }
  }, [status]);

  // ---------- 鼠标/触摸事件 ----------
  const handlePointerDown = useCallback(() => {
    if (status === "reviewing" || status === "processing") return;
    isPressedRef.current = true;
    setTranscript("");
    setInterimText("");
    setParsedMembers([]);
    startRecording();
  }, [status, startRecording]);

  const handlePointerUp = useCallback(() => {
    if (!isPressedRef.current) return;
    isPressedRef.current = false;
    stopRecording();
  }, [stopRecording]);

  // ---------- 松开后自动调用 AI 解析 ----------
  useEffect(() => {
    if (status === "processing" && transcript.trim()) {
      const timeout = setTimeout(async () => {
        try {
          const members = await parseTextToMembers(transcript);
          if (members.length === 0) {
            setErrorMsg("未能从语音中提取到家族成员信息，请重新录制或手动录入。");
            setStatus("idle");
            return;
          }
          setParsedMembers(members);
          setStatus("reviewing");
        } catch {
          setErrorMsg("AI 解析失败，请重试。");
          setStatus("idle");
        }
      }, 300);
      return () => clearTimeout(timeout);
    }
    if (status === "processing" && !transcript.trim()) {
      setStatus("idle");
    }
  }, [status, transcript]);

  // ---------- 确认/跳过单个成员 ----------
  const handleConfirm = useCallback((tempId: string) => {
    setParsedMembers((prev: ParsedMember[]) =>
      prev.map((m: ParsedMember) =>
        m.tempId === tempId ? { ...m, confirmed: true, skipped: false } : m
      )
    );
  }, []);

  const handleSkip = useCallback((tempId: string) => {
    setParsedMembers((prev: ParsedMember[]) =>
      prev.map((m: ParsedMember) =>
        m.tempId === tempId ? { ...m, skipped: true, confirmed: false } : m
      )
    );
  }, []);

  // ---------- 批量导入 ----------
  const handleImport = useCallback(() => {
    const confirmed = parsedMembers.filter((m: ParsedMember) => m.confirmed);
    if (confirmed.length === 0) return;

    const newMembers: Member[] = confirmed.map((m: ParsedMember) => ({
      id: generateId(),
      name: m.name,
      birth: m.birth || undefined,
    }));

    onMembersReady(newMembers);
    // 重置状态准备下一次录音
    setTranscript("");
    setInterimText("");
    setParsedMembers([]);
    setStatus("idle");
    setErrorMsg("");
  }, [parsedMembers, onMembersReady]);

  // ---------- 清除状态 ----------
  const handleReset = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setTranscript("");
    setInterimText("");
    setParsedMembers([]);
    setStatus("idle");
    setErrorMsg("");
  }, []);

  // ---------- 组件卸载时停止 ----------
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  // ---------- 渲染 ----------
  // 服务端渲染 / 首次 hydration 时，渲染占位符等待客户端确认
  // （所有 hooks 已在 return 前执行完毕，保证调用顺序一致）
  if (!mounted) {
    return (
      <div className="w-full mb-6">
        <div className="w-full max-w-xs py-4 rounded-2xl bg-gray-200 text-gray-400 font-bold text-base mx-auto flex items-center justify-center gap-2">
          <span className="text-2xl">🎤</span>
          <span>语音录入</span>
        </div>
      </div>
    );
  }

  // ---------- 浏览器不支持 ----------
  if (!isSupported) {
    return (
      <div className="w-full mb-6">
        <button
          disabled
          className="w-full py-4 rounded-2xl bg-gray-200 text-gray-400 font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
        >
          <span className="text-2xl">🎤</span>
          <span>您的浏览器不支持语音录入</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full mb-6 space-y-3">
      {/* ---------- 按住说话按钮（微信风格） ---------- */}
      <div className="flex flex-col items-center">
        <button
          onMouseDown={handlePointerDown}
          onMouseUp={handlePointerUp}
          onMouseLeave={() => {
            if (status === "listening") handlePointerUp();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            handlePointerDown();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            handlePointerUp();
          }}
          disabled={status === "reviewing" || status === "processing"}
          className={`
            w-full max-w-xs py-4 rounded-2xl flex items-center justify-center gap-2
            font-bold text-base tracking-wider select-none
            transition-all duration-200
            ${
              status === "listening"
                ? "bg-red-600 text-white scale-[0.97] shadow-lg shadow-red-400/50"
                : "bg-gradient-to-r from-[#2d5a27] to-[#3d7a35] text-white hover:shadow-xl hover:scale-[1.02] active:scale-[0.97]"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {status === "idle" && (
            <>
              <span className="text-2xl">🎤</span>
              <span>按住说话</span>
            </>
          )}
          {status === "listening" && (
            <>
              <span className="text-2xl animate-pulse">🔴</span>
              <span className="whitespace-nowrap">松开识别</span>
              {/* 声波动画 */}
              <div className="flex items-center gap-[3px] ml-1">
                <span className="w-[3px] h-3 bg-white/80 rounded-full animate-pulse" style={{ animationDelay: "0ms", animationDuration: "0.8s" }} />
                <span className="w-[3px] h-5 bg-white/80 rounded-full animate-pulse" style={{ animationDelay: "150ms", animationDuration: "0.8s" }} />
                <span className="w-[3px] h-4 bg-white/80 rounded-full animate-pulse" style={{ animationDelay: "300ms", animationDuration: "0.8s" }} />
                <span className="w-[3px] h-6 bg-white/80 rounded-full animate-pulse" style={{ animationDelay: "450ms", animationDuration: "0.8s" }} />
                <span className="w-[3px] h-3 bg-white/80 rounded-full animate-pulse" style={{ animationDelay: "600ms", animationDuration: "0.8s" }} />
              </div>
            </>
          )}
          {status === "processing" && (
            <>
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              <span>识别中…</span>
            </>
          )}
        </button>

        {/* 提示文字（微信风格：按钮下方浅灰色提示） */}
        {status === "idle" && (
          <p className="text-xs text-[#5c3a2e]/40 mt-2">
            按住按钮说话，松手自动识别成员
          </p>
        )}
        {status === "listening" && (
          <p className="text-xs text-red-600/60 mt-2 animate-pulse">
            正在聆听，请说出家族成员信息…
          </p>
        )}
      </div>

      {/* ---------- 语音识别文本 ---------- */}
      {(transcript || interimText) && status !== "reviewing" && (
        <div className="bg-white rounded-xl border border-[#d4a76a]/30 p-3 min-h-[44px]">
          <p className="text-sm text-[#5c3a2e] leading-relaxed whitespace-pre-wrap">
            {transcript}
            <span className="text-[#c4a67a]">{interimText}</span>
          </p>
        </div>
      )}

      {/* ---------- 错误信息 ---------- */}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
          {errorMsg}
          <button
            onClick={handleReset}
            className="ml-2 underline hover:text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {/* ---------- AI 解析中 ---------- */}
      {status === "processing" && transcript && (
        <div className="flex items-center gap-3 justify-center py-3">
          <div className="w-4 h-4 border-2 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin" />
          <span className="text-sm text-[#5c3a2e]/60">正在用 AI 提取成员信息…</span>
        </div>
      )}

      {/* ---------- 人工确认环节（预览列表） ---------- */}
      {status === "reviewing" && parsedMembers.length > 0 && (
        <div className="bg-[#fdfbf7] border-2 border-[#d4a76a]/30 rounded-2xl p-4">
          <div className="text-center mb-3">
            <p className="text-sm font-bold text-[#8b0000] tracking-wider">
              🤝 AI 辅助识别，请逐条核对确认后再导入
            </p>
          </div>

          <div className="space-y-2 mb-3">
            {parsedMembers.map((member: ParsedMember) => {
              return (
                <div
                  key={member.tempId}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    member.confirmed
                      ? "bg-green-50 border-green-300"
                      : member.skipped
                        ? "bg-gray-50 border-gray-200 opacity-50"
                        : "bg-white border-[#d4a76a]/30 hover:border-[#8b0000]/30"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0 ${
                      member.gender === "女"
                        ? "bg-pink-100 text-pink-600"
                        : member.gender === "男"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-[#f5f0e8] text-[#5c3a2e]"
                    }`}
                  >
                    {member.name.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#5c3a2e]">
                        {member.name}
                      </span>
                      {member.birth && (
                        <span className="text-xs text-[#c4a67a]">
                          生于 {member.birth} 年
                        </span>
                      )}
                      {member.gender && (
                        <span className="text-xs text-[#c4a67a]">
                          {member.gender}
                        </span>
                      )}
                    </div>
                    {member.relation && (
                      <p className="text-xs text-[#5c3a2e]/60 mt-0.5">
                        关系：{member.relation}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {member.confirmed ? (
                      <span className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg font-bold">
                        ✓ 已确认
                      </span>
                    ) : member.skipped ? (
                      <span className="px-3 py-1 text-xs bg-gray-100 text-gray-400 rounded-lg">
                        已跳过
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleConfirm(member.tempId)}
                          className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          ✓ 确认
                        </button>
                        <button
                          onClick={() => handleSkip(member.tempId)}
                          className="px-3 py-1 text-xs font-bold bg-gray-200 text-gray-500 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          跳过
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={parsedMembers.filter((m: ParsedMember) => m.confirmed).length === 0}
              className="flex-1 py-3 rounded-xl font-bold tracking-wider text-base bg-gradient-to-r from-[#2d5a27] to-[#3d7a35] text-white hover:shadow-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✓ 导入已确认成员（{parsedMembers.filter((m: ParsedMember) => m.confirmed).length}）
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-3 rounded-xl font-bold tracking-wider text-base bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all"
            >
              重新录制
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// 成员表单组件（弹出层）
// ====================================================================
function MemberForm({
  members,
  editingMember,
  onConfirm,
  onCancel,
}: MemberFormProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(editingMember?.name || "");
  const [gender, setGender] = useState(editingMember?.gender || "");
  const [birthYear, setBirthYear] = useState(editingMember?.birth?.split("-")[0] || "");
  const [birthMonth, setBirthMonth] = useState(editingMember?.birth?.split("-")[1] || "");
  const [birthDay, setBirthDay] = useState(editingMember?.birth?.split("-")[2] || "");
  const [father, setFather] = useState(editingMember?.fatherId || "");
  const [mother, setMother] = useState(editingMember?.motherId || "");
  const [spouse, setSpouse] = useState(editingMember?.spouseId || "");

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onCancel]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const birth = [birthYear, birthMonth, birthDay]
      .filter(Boolean)
      .join("-") || undefined;
    onConfirm({
      id: editingMember?.id || generateId(),
      name: name.trim(),
      gender: (gender === "男" || gender === "女" ? gender : undefined) as "男" | "女" | undefined,
      birth,
      fatherId: father || undefined,
      motherId: mother || undefined,
      spouseId: spouse || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div
        ref={formRef}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 space-y-5"
      >
        <h2 className="text-xl font-bold text-[#5c3a2e] text-center border-b border-[#d4a76a]/20 pb-3">
          {editingMember ? "✏️ 编辑成员" : "👤 添加成员"}
        </h2>

        {/* 姓名 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">
            姓名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入姓名"
            className="w-full px-4 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 focus:border-[#8b0000]/50 text-[#5c3a2e] placeholder:text-[#c4a67a]/50"
            autoFocus
          />
        </div>

        {/* 性别 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">性别</label>
          <div className="flex gap-3">
            {["男", "女"].map((g) => (
              <button
                key={g}
                onClick={() => setGender(gender === g ? "" : g)}
                className={`px-5 py-2 rounded-xl font-bold text-sm transition-all ${
                  gender === g
                    ? "bg-[#5c3a2e] text-white"
                    : "bg-[#f5f0e8] text-[#5c3a2e] hover:bg-[#e8dfd0]"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* 出生日期 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">出生日期</label>
          <div className="flex gap-2">
            <select
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
            >
              {YEAR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}年
                </option>
              ))}
            </select>
            <select
              value={birthMonth}
              onChange={(e) => setBirthMonth(e.target.value)}
              className="w-20 px-3 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
            >
              {MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}月
                </option>
              ))}
            </select>
            <select
              value={birthDay}
              onChange={(e) => setBirthDay(e.target.value)}
              className="w-20 px-3 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
            >
              {DAY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}日
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 关系：父亲 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">父亲</label>
          <select
            value={father}
            onChange={(e) => setFather(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
          >
            <option value="">（未知）</option>
            {members
              .filter((m) => m.gender === "男" && m.id !== editingMember?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>

        {/* 关系：母亲 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">母亲</label>
          <select
            value={mother}
            onChange={(e) => setMother(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
          >
            <option value="">（未知）</option>
            {members
              .filter((m) => m.gender === "女" && m.id !== editingMember?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>

        {/* 关系：配偶 */}
        <div>
          <label className="block text-sm font-bold text-[#5c3a2e] mb-1.5">配偶</label>
          <select
            value={spouse}
            onChange={(e) => setSpouse(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[#d4a76a]/30 bg-[#fdfbf7] focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 text-[#5c3a2e] text-sm"
          >
            <option value="">（未知）</option>
            {members
              .filter((m) => m.id !== editingMember?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>

        {/* 按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl font-bold tracking-wider text-sm bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 py-3 rounded-xl font-bold tracking-wider text-sm bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editingMember ? "保存修改" : "确认添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// 保存进度组件
// ====================================================================
function SavingProgress({
  progress,
  message,
}: {
  progress: number;
  message: string;
}) {
  return (
    <div className="mt-4 p-4 bg-white border border-[#d4a76a]/20 rounded-xl space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-[#d4a76a]/30 border-t-[#8b0000] rounded-full animate-spin" />
        <span className="text-sm font-bold text-[#5c3a2e]">{message}</span>
      </div>
      <div className="w-full bg-[#f5f0e8] rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#8b0000] to-[#a52a2a] rounded-full transition-all duration-500"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <p className="text-xs text-[#c4a67a] text-right">{Math.round(progress)}%</p>
    </div>
  );
}

// ====================================================================
// 主页面
// ====================================================================
export default function CreateTreePage() {
  const router = useRouter();
  const { isLoggedIn, emailHash } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saveState, setSaveState] = useState<{
    status: "idle" | "saving" | "success" | "error";
    progress: number;
    message: string;
  }>({ status: "idle", progress: 0, message: "" });
  const [isPublic, setIsPublic] = useState(false);

  // ---------- 辅助：确保成员数组中指定 ID 的父/母/配偶关系同步 ----------
  const syncRelations = useCallback((prev: Member[], member: Member): Member[] => {
    // 我们需要同步的关系有：
    // 1. fatherId → 父亲的 childrenIds 包含该成员
    // 2. motherId → 母亲的 childrenIds 包含该成员
    // 3. spouseId → 配偶的 spouseId 指向该成员

    // 先移除该成员从旧关系的引用中
    let result = prev.map((m) => {
      // 从 childrenIds 中移除该成员
      if (m.childrenIds?.includes(member.id)) {
        return { ...m, childrenIds: m.childrenIds.filter((cid) => cid !== member.id) };
      }
      // 从配偶中解除
      if (m.spouseId === member.id) {
        return { ...m, spouseId: undefined };
      }
      return m;
    });

    // 添加新关系的引用
    result = result.map((m) => {
      if (m.id === member.fatherId || m.id === member.motherId) {
        // 向父/母亲添加 childrenIds
        const childrenIds = m.childrenIds || [];
        if (!childrenIds.includes(member.id)) {
          return { ...m, childrenIds: [...childrenIds, member.id] };
        }
      }
      if (m.id === member.spouseId) {
        // 向配偶添加 spouseId
        return { ...m, spouseId: member.id };
      }
      return m;
    });

    return result;
  }, []);

  // ---------- 添加 / 编辑成员 ----------
  const handleConfirmMember = useCallback((member: Member) => {
    setMembers((prev) => {
      const idx = prev.findIndex((m) => m.id === member.id);
      let next: Member[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = member;
      } else {
        next = [...prev, member];
      }
      // 双向同步关系
      next = syncRelations(next, member);
      return next;
    });
    setShowForm(false);
    setEditingMember(null);
  }, [syncRelations]);

  const handleDeleteMember = useCallback((id: string) => {
    setMembers((prev) => {
      // 先清理其他成员对该成员的引用
      const cleaned = prev.map((m) => {
        let updated = { ...m };
        if (updated.childrenIds?.includes(id)) {
          updated.childrenIds = updated.childrenIds.filter((cid) => cid !== id);
        }
        if (updated.spouseId === id) {
          updated.spouseId = undefined;
        }
        if (updated.fatherId === id) {
          updated.fatherId = undefined;
        }
        if (updated.motherId === id) {
          updated.motherId = undefined;
        }
        if (updated.parentId === id) {
          updated.parentId = undefined;
        }
        if (updated.spouseOf === id) {
          updated.spouseOf = undefined;
        }
        return updated;
      });
      // 再删除本身
      return cleaned.filter((m) => m.id !== id);
    });
  }, []);

  const handleCancelForm = useCallback(() => {
    setShowForm(false);
    setEditingMember(null);
  }, []);

  const handleAddMember = useCallback(() => {
    setEditingMember(null);
    setShowForm(true);
  }, []);

  const handleEditMember = useCallback((member: Member) => {
    setEditingMember(member);
    setShowForm(true);
  }, []);

  // ---------- 语音导入 ----------
  const handleVoiceMembersReady = useCallback(
    (newMembers: Member[]) => {
      setMembers((prev) => [...prev, ...newMembers]);
    },
    []
  );

  // ---------- 保存族谱 ----------
  const handleSave = useCallback(async () => {
    if (members.length === 0) return;
    setSaveState({ status: "saving", progress: 0, message: "正在保存…" });

    try {
      setSaveState((prev) => ({ ...prev, progress: 30, message: "正在保存数据到区块链…" }));

      const body: Record<string, any> = {
        familyName: `家族树 (${new Date().toLocaleDateString()})`,
        members,
        searchable: isPublic,
      };
      if (emailHash) {
        body.emailHash = emailHash;
      }

      const response = await fetch("/api/save-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.success || !result.familyId) {
        throw new Error(result.error || "保存失败");
      }

      setSaveState({ status: "success", progress: 100, message: "保存成功！" });

      setTimeout(() => {
        router.push(`/family/${result.familyId}`);
      }, 1500);
    } catch (e: any) {
      setSaveState({ status: "error", progress: 0, message: e.message || "保存失败" });
    }
  }, [members, emailHash, router]);

  return (
    <div className="min-h-screen bg-[#fdfbf7]">
      {/* 顶部装饰条 */}
      <div className="h-2 bg-gradient-to-r from-[#8b0000] via-[#a52a2a] to-[#8b0000]" />

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* 页面标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#5c3a2e] tracking-wider">
            🌳 创建家族树
          </h1>
          <p className="text-sm text-[#c4a67a] mt-1 tracking-wider">
            添加您的家庭成员信息，一键保存族谱
          </p>
        </div>

        {/* 语音录入 */}
        <VoiceRecordButton onMembersReady={handleVoiceMembersReady} />

        {/* 成员列表 */}
        <div className="bg-white rounded-3xl border border-[#d4a76a]/20 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#5c3a2e] tracking-wider">
              成员列表
            </h2>
            <button
              onClick={handleAddMember}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all"
            >
              + 添加成员
            </button>
          </div>

          {members.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">👥</div>
              <p className="text-[#5c3a2e]/60 text-base">
                还没有添加成员，请点击上方按钮添加
              </p>
              <p className="text-[#c4a67a] text-sm mt-1">
                或使用语音录入功能快速导入
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member, index) => (
                <div
                  key={member.id}
                  className="flex items-center p-3 rounded-xl border border-[#d4a76a]/20 hover:border-[#d4a76a]/50 bg-[#fdfbf7] transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-[#f5f0e8] flex items-center justify-center text-sm font-bold text-[#5c3a2e] mr-3">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#5c3a2e]">
                        {member.name}
                      </span>
                      {member.gender && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f0e8] text-[#c4a67a]">
                          {member.gender}
                        </span>
                      )}
                      {member.birth && (
                        <span className="text-xs text-[#c4a67a]/60">
                          生于 {member.birth}
                        </span>
                      )}
                    </div>
                    {member.fatherId && (
                      <p className="text-xs text-[#5c3a2e]/40 mt-0.5">
                        已关联父亲
                      </p>
                    )}
                    {member.motherId && (
                      <p className="text-xs text-[#5c3a2e]/40 mt-0.5">
                        已关联母亲
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => handleEditMember(member)}
                      className="px-2.5 py-1 text-xs font-bold bg-[#f5f0e8] text-[#5c3a2e] rounded-lg hover:bg-[#e8dfd0] transition-all"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteMember(member.id)}
                      className="px-2.5 py-1 text-xs font-bold bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-all"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 公开/隐私开关 */}
        <div className="mt-6 bg-white rounded-2xl border border-[#d4a76a]/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label className="text-sm font-bold text-[#5c3a2e] flex items-center gap-2">
                <span>🔍</span>
                <span>允许他人通过家族名搜索到此家族</span>
              </label>
              <p className="text-xs text-[#c4a67a] mt-1 leading-relaxed">
                开启后，家族名和简介可能被公开搜索到，请勿填写个人隐私
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              onClick={() => setIsPublic((prev) => !prev)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#8b0000]/30 ${
                isPublic ? "bg-[#8b0000]" : "bg-gray-200"
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isPublic ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* 保存进度 */}
        {saveState.status === "saving" && (
          <SavingProgress
            progress={saveState.progress}
            message={saveState.message}
          />
        )}
        {saveState.status === "success" && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-bold text-green-800">保存成功！</p>
              <p className="text-sm text-green-600">正在跳转到详情页…</p>
            </div>
          </div>
        )}
        {saveState.status === "error" && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <span className="text-2xl">❌</span>
            <div className="flex-1">
              <p className="font-bold text-red-800">保存失败</p>
              <p className="text-sm text-red-600">{saveState.message}</p>
            </div>
            <button
              onClick={() => setSaveState({ status: "idle", progress: 0, message: "" })}
              className="px-4 py-2 text-sm font-bold bg-red-200 text-red-700 rounded-xl hover:bg-red-300 transition-all"
            >
              重试
            </button>
          </div>
        )}

        {/* 保存按钮 */}
        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={members.length === 0 || saveState.status === "saving"}
            className="w-full py-4 rounded-2xl font-black text-lg tracking-wider bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-2xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saveState.status === "saving"
              ? "保存中…"
              : members.length === 0
                ? "请先添加成员"
                : "💾 保存族谱"}
          </button>
          <p className="text-xs text-[#c4a67a] text-center mt-2">
            保存后将生成唯一的族谱链接，方便分享给家人
          </p>
        </div>
      </div>

      {/* 成员表单弹出层 */}
      {showForm && (
        <MemberForm
          members={members}
          editingMember={editingMember}
          onConfirm={handleConfirmMember}
          onCancel={handleCancelForm}
        />
      )}
    </div>
  );
}
