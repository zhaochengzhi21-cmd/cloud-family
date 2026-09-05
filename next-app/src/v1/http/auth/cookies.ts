/**
 * Session cookie helpers for V1 Auth HTTP.
 */

import {
  V1_SESSION_COOKIE,
  V1_SESSION_COOKIE_NAME,
} from "@/v1/domain/auth/types";

export { V1_SESSION_COOKIE_NAME };

export function buildSessionCookieHeader(
  rawToken: string,
  expiresAt: Date,
  options?: { secure?: boolean }
): string {
  const secure =
    options?.secure ??
    (process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production");

  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  );
  const parts = [
    `${V1_SESSION_COOKIE.name}=${rawToken}`,
    `Path=${V1_SESSION_COOKIE.path}`,
    `HttpOnly`,
    `SameSite=${V1_SESSION_COOKIE.sameSite}`,
    `Max-Age=${maxAge || V1_SESSION_COOKIE.maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearSessionCookieHeader(options?: {
  secure?: boolean;
}): string {
  const secure =
    options?.secure ??
    (process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production");
  const parts = [
    `${V1_SESSION_COOKIE.name}=`,
    `Path=${V1_SESSION_COOKIE.path}`,
    `HttpOnly`,
    `SameSite=${V1_SESSION_COOKIE.sameSite}`,
    `Max-Age=0`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionTokenFromCookieHeader(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === V1_SESSION_COOKIE_NAME) {
      const v = rest.join("=").trim();
      return v || null;
    }
  }
  return null;
}
