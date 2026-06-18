"use client";

import React, { useState, useEffect, useCallback } from "react";

interface MatchNotification {
  matchFamilyId: string;
  familyName: string;
  matchedAt: string;
}

interface ConnectionInfo {
  connectedFamilyId: string;
  connectedFamilyName: string;
  connectedAt: string;
}

interface NotificationData {
  hasNewResults: boolean;
  newResults: MatchNotification[];
  connections: ConnectionInfo[];
}

interface MatchNotificationBarProps {
  familyId: string;
  /** 滚动到匹配区域的回调 */
  onScrollToMatching: () => void;
}

/**
 * 轻量提示信息条
 *
 * 当家族开启了匹配且有新的匹配结果时，在页面顶部显示一条可关闭的信息条
 */
export default function MatchNotificationBar({
  familyId,
  onScrollToMatching,
}: MatchNotificationBarProps) {
  const [notification, setNotification] = useState<NotificationData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // 加载通知
  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/family-matching/${familyId}/notifications`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setNotification(data);
      }
    } catch {
      // 静默失败
    }
  }, [familyId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // 如果没有新结果或已关闭，不显示
  if (!notification || !notification.hasNewResults || dismissed) {
    return null;
  }

  const handleDismiss = async () => {
    setDismissed(true);
    // 逐个关闭通知
    for (const result of notification.newResults) {
      try {
        await fetch(`/api/family-matching/${familyId}/notifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchFamilyId: result.matchFamilyId }),
        });
      } catch {
        // 静默失败
      }
    }
  };

  const handleViewDetails = () => {
    setDismissed(true);
    onScrollToMatching();
  };

  return (
    <div className="animate-slideDown mb-4">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">💡</span>
            <p className="text-sm text-[#5c3a2e] truncate">
              系统发现其他家族与您的家族存在相似结构。
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleViewDetails}
              className="text-xs font-bold text-[#8b0000] hover:text-[#a52a2a] underline underline-offset-2 whitespace-nowrap transition-colors"
            >
              查看
            </button>
            <button
              onClick={handleDismiss}
              className="w-6 h-6 flex items-center justify-center rounded-full text-[#c4a67a] hover:text-[#5c3a2e] hover:bg-white/60 transition-all"
              aria-label="关闭"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}