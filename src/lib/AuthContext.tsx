"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

/**
 * Auth 上下文类型
 */
interface AuthContextType {
  /** 是否已登录 */
  isLoggedIn: boolean;
  /** 邮箱哈希（脱敏邮箱用于展示） */
  emailHash: string | null;
  /** 脱敏后的邮箱显示 */
  maskedEmail: string | null;
  /** 设置登录状态（由 LoginModal 调用） */
  setAuth: (emailHash: string, rawEmail?: string) => void;
  /** 退出登录 */
  logout: () => void;
  /** 从 cookie 恢复登录状态 */
  restoreSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  emailHash: null,
  maskedEmail: null,
  setAuth: () => {},
  logout: () => {},
  restoreSession: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * 脱敏邮箱显示
 * "abc@example.com" → "a***@example.com"
 */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return name.charAt(0) + "***@" + domain;
}

/**
 * 通过服务端 API 验证 httpOnly cookie 中的 token
 */
async function fetchSessionFromServer(): Promise<{ emailHash: string } | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.data?.emailHash) {
      return { emailHash: data.data.emailHash };
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [emailHash, setEmailHash] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const setAuth = useCallback((hash: string, rawEmail?: string) => {
    setEmailHash(hash);
    setIsLoggedIn(true);
    if (rawEmail) {
      setMaskedEmail(maskEmail(rawEmail));
    } else {
      setMaskedEmail(hash.slice(0, 8) + "***");
    }
  }, []);

  const logout = useCallback(() => {
    setEmailHash(null);
    setMaskedEmail(null);
    setIsLoggedIn(false);
    // 清除 cookie
    document.cookie = "token=; path=/; max-age=0";
  }, []);

  const restoreSession = useCallback(async () => {
    const sessionData = await fetchSessionFromServer();
    if (sessionData && sessionData.emailHash) {
      setEmailHash(sessionData.emailHash);
      setMaskedEmail(sessionData.emailHash.slice(0, 8) + "***");
      setIsLoggedIn(true);
    }
  }, []);

  // 首次加载时尝试恢复会话
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, emailHash, maskedEmail, setAuth, logout, restoreSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}