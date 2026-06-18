"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  msgId: string;
  content: string;
  isMine: boolean;
  createdAt: string;
}

interface ConnectionInfo {
  connectedFamilyId: string;
  connectedFamilyName: string;
  connectedAt: string;
}

interface AnonymousChatProps {
  familyId: string;
  /** 已连接的家族信息 */
  connection: ConnectionInfo;
  /** 断开连接后的回调 */
  onDisconnected: () => void;
}

/**
 * 匿名聊天组件
 *
 * 已建立连接的家族之间互相发送匿名消息
 * 聊天记录保存在 KV 且 30 天过期
 * 任何一方可随时退出，退出后聊天记录自动清除
 */
export default function AnonymousChat({
  familyId,
  connection,
  onDisconnected,
}: AnonymousChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { connectedFamilyId, connectedFamilyName } = connection;

  // 加载消息历史
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/family-matching/${familyId}/message?targetFamilyId=${connectedFamilyId}`
      );
      if (!res.ok) {
        // 如果 400（连接已断开），停止轮询
        if (res.status === 400) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          onDisconnected();
        }
        return;
      }
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [familyId, connectedFamilyId, onDisconnected]);

  // 初始加载
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // 轮询新消息（每5秒）
  useEffect(() => {
    pollingRef.current = setInterval(loadMessages, 5000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [loadMessages]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 发送消息
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/family-matching/${familyId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetFamilyId: connectedFamilyId,
          content: text,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInputText("");
        // 立即刷新消息
        await loadMessages();
      }
    } catch {
      // 静默失败
    } finally {
      setSending(false);
    }
  };

  // 发送消息（回车）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 退出聊天
  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch(`/api/family-matching/${familyId}/message`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetFamilyId: connectedFamilyId }),
      });
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      onDisconnected();
    } catch {
      // 静默失败
    } finally {
      setDisconnecting(false);
      setShowConfirmExit(false);
    }
  };

  // 格式化时间
  const formatTime = (isoStr: string) => {
    try {
      const date = new Date(isoStr);
      return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div className="animate-pulse flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-[#8b0000] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 聊天头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-[#5c3a2e]">
            与 {connectedFamilyName} 的私密沟通
          </span>
        </div>
        {!showConfirmExit ? (
          <button
            onClick={() => setShowConfirmExit(true)}
            className="text-xs text-[#c4a67a] hover:text-[#8b0000] transition-colors"
          >
            退出聊天
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#5c3a2e]">确认退出？</span>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs font-medium text-[#8b0000] hover:text-red-700 disabled:opacity-50 transition-colors"
            >
              {disconnecting ? "退出中…" : "确认"}
            </button>
            <button
              onClick={() => setShowConfirmExit(false)}
              className="text-xs text-[#c4a67a] hover:text-[#5c3a2e] transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* 消息区域 */}
      <div className="h-80 overflow-y-auto px-4 py-3 space-y-3 bg-white/40">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[#c4a67a] text-sm">
                已建立连接，开始发送第一条消息吧
              </p>
              <p className="text-xs text-gray-300 mt-1">
                消息保存 30 天后自动清除
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.msgId}
              className={`flex ${msg.isMine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  msg.isMine
                    ? "bg-[#8b0000] text-white rounded-br-md"
                    : "bg-gray-100 text-[#5c3a2e] rounded-bl-md"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
                <p
                  className={`text-[10px] mt-1 ${
                    msg.isMine ? "text-white/60" : "text-gray-400"
                  }`}
                >
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white/60">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            maxLength={2000}
            className="flex-1 px-4 py-2 text-sm rounded-full border border-gray-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#8b0000]/20 focus:border-[#8b0000]/30 text-[#5c3a2e] placeholder-gray-300 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            className="px-4 py-2 rounded-full bg-[#8b0000] text-white text-sm font-medium hover:bg-[#a52a2a] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "发送"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}