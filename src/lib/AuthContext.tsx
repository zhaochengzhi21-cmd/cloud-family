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
 * 从 cookie 中读取 token 并解析
 */
function parseTokenFromCookie(): { emailHash: string } | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
  if (!match) return null;
  try {
    // token 是 JWT，从中解析 payload
    const parts = match[1].split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload && payload.emailHash) {
      return { emailHash: payload.emailHash };
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
    const tokenData = parseTokenFromCookie();
    if (tokenData && tokenData.emailHash) {
      setEmailHash(tokenData.emailHash);
      setMaskedEmail(tokenData.emailHash.slice(0, 8) + "***");
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