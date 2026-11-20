"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ERROR_COPY, LOGIN_COPY, PRODUCT } from "@/v1/ui/copy";
import { v1api, V1ApiError } from "@/v1/client/api";

const EMAIL_KEY = "alpha-last-email";

function maskEmail(raw: string): string {
  const email = raw.trim();
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ""}*${domain}`;
  return `${local.slice(0, 2)}··${domain}`;
}

/** Only same-site Alpha paths; rejects absolute and protocol-relative URLs. */
function safeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/alpha/") || raw.startsWith("//")) return null;
  if (/[\\\s]/.test(raw) || raw.startsWith("/alpha/login")) return null;
  return raw;
}

/**
 * Family join links (`/alpha/invite/...`) are not Closed Alpha registration codes.
 * Detect them so we can send the user to InviteLanding instead of stuffing the
 * path token into the 内测邀请码 field.
 */
function familyInviteHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const asUrl = trimmed.includes("://")
      ? new URL(trimmed)
      : trimmed.startsWith("/alpha/invite/")
        ? new URL(trimmed, "https://example.invalid")
        : null;
    if (asUrl) {
      const m = asUrl.pathname.match(/\/alpha\/invite\/([^/?#]+)/i);
      if (m?.[1]) return `/alpha/invite/${decodeURIComponent(m[1])}`;
    }
  } catch {
    /* fall through */
  }
  const inline = trimmed.match(/\/alpha\/invite\/([^/?#\s]+)/i);
  if (inline?.[1]) return `/alpha/invite/${decodeURIComponent(inline[1])}`;
  return null;
}

/** Closed Alpha registration invite codes (bare tokens only). */
function normalizeInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || familyInviteHref(trimmed)) return "";
  return trimmed;
}

export default function AlphaLoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const expired = search.get("reason") === "expired";
  const nextPath = safeNextPath(search.get("next"));
  const inviteFromUrl = normalizeInviteToken(search.get("invite") ?? "");
  const showInviteFromUrl =
    search.get("showInvite") === "1" || Boolean(inviteFromUrl);

  const [email, setEmail] = useState("");
  const [inviteToken, setInviteToken] = useState(inviteFromUrl);
  const [showInvite, setShowInvite] = useState(showInviteFromUrl);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(
    expired
      ? nextPath
        ? `${ERROR_COPY.unauthenticated}登录后将回到刚才的页面。`
        : ERROR_COPY.unauthenticated
      : nextPath
        ? "登录后将回到刚才的页面。"
        : ""
  );
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);
  const autoSubmitRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!inviteFromUrl && !showInviteFromUrl) return;
    if (inviteFromUrl) setInviteToken(inviteFromUrl);
    setShowInvite(true);
  }, [inviteFromUrl, showInviteFromUrl]);

  useEffect(() => {
    const prev = document.title;
    document.title = `登录 · ${PRODUCT.brand}`;
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    if (challengeId && challengeId !== "pending") {
      otpRef.current?.focus();
    }
  }, [challengeId]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current != null) {
        window.clearInterval(cooldownTimerRef.current);
      }
    };
  }, []);

  function startCooldown() {
    if (cooldownTimerRef.current != null) {
      window.clearInterval(cooldownTimerRef.current);
    }
    setCooldown(60);
    cooldownTimerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (cooldownTimerRef.current != null) {
            window.clearInterval(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function requestCode() {
    setBusy(true);
    setMessage("");
    autoSubmitRef.current = false;
    try {
      const trimmed = email.trim();
      const body: { email: string; inviteToken?: string } = {
        email: trimmed,
      };
      if (showInvite && inviteToken.trim()) {
        body.inviteToken = normalizeInviteToken(inviteToken);
      }
      const res = await v1api.requestCode(body);
      try {
        localStorage.setItem(EMAIL_KEY, trimmed);
      } catch {
        /* private mode */
      }
      setChallengeId(res.challengeId ?? "pending");
      setMessage(ERROR_COPY.requestCodeGeneric);
      startCooldown();
    } catch (err) {
      if (err instanceof V1ApiError && err.status === 404) {
        setMessage("当前环境暂未开放登录。");
      } else {
        setMessage(ERROR_COPY.requestCodeGeneric);
        setChallengeId("pending");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRequestCode(e: FormEvent) {
    e.preventDefault();
    await requestCode();
  }

  async function verifyCode(nextCode: string) {
    if (!challengeId || challengeId === "pending") {
      setMessage(ERROR_COPY.verifyFailed);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await v1api.verify({ challengeId, code: nextCode.trim() });
      router.replace(nextPath ?? "/alpha/families");
    } catch {
      setMessage(ERROR_COPY.verifyFailed);
      autoSubmitRef.current = false;
      setCode("");
      requestAnimationFrame(() => {
        otpRef.current?.focus();
        otpRef.current?.select();
      });
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    await verifyCode(code);
  }

  useEffect(() => {
    if (code.length !== 6) {
      autoSubmitRef.current = false;
      return;
    }
    if (!challengeId || challengeId === "pending" || busy) return;
    if (autoSubmitRef.current) return;
    autoSubmitRef.current = true;
    void verifyCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit once when OTP reaches 6 digits
  }, [code, challengeId, busy]);

  return (
    <div className="mx-auto max-w-md py-10 sm:py-16">
      <div className="alpha-fade-in mb-8">
        <div className="alpha-login-mark alpha-font-display mb-5" aria-hidden>
          云
        </div>
        <p className="mb-2 text-sm font-semibold tracking-[0.16em] text-[color:var(--a-brand)]">
          ALPHA · 邀请制
        </p>
        <h1 className="alpha-font-display text-4xl font-bold leading-none tracking-wide text-[color:var(--a-ink)] sm:text-5xl">
          {PRODUCT.brand}
        </h1>
        <p className="mt-4 text-lg font-semibold leading-snug text-[color:var(--a-ink)]">
          {LOGIN_COPY.title}
        </p>
        <p className="mt-3 text-base leading-relaxed text-[color:var(--a-muted)]">
          {LOGIN_COPY.subtitle}
        </p>
      </div>

      <div className="alpha-fade-in-delay alpha-panel p-5 sm:p-6">
        {!challengeId ? (
          <form onSubmit={onRequestCode} className="space-y-5">
            <div>
              <label htmlFor="alpha-email" className="alpha-label">
                邮箱
              </label>
              <input
                id="alpha-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="alpha-input"
              />
            </div>

            {showInvite ? (
              <div>
                <label htmlFor="alpha-invite" className="alpha-label">
                  邀请码
                </label>
                <input
                  id="alpha-invite"
                  type="text"
                  autoComplete="off"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  onBlur={() => {
                    const href = familyInviteHref(inviteToken);
                    if (href) {
                      router.push(href);
                      return;
                    }
                    setInviteToken((t) => normalizeInviteToken(t));
                  }}
                  className="alpha-input"
                  placeholder="粘贴内测邀请码"
                />
                <p className="mt-1 text-xs text-[color:var(--a-muted)]">
                  这是开通云族谱内测账号用的邀请码。若家人发来的是「加入家族」链接（含
                  /alpha/invite/），请直接打开该链接，不要填在这里。
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-sm font-semibold text-[color:var(--a-brand)]"
                    onClick={() => {
                      void (async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          const href = familyInviteHref(text);
                          if (href) {
                            setMessage("识别到家族邀请链接，正在打开…");
                            router.push(href);
                            return;
                          }
                          const normalized = normalizeInviteToken(text);
                          if (normalized) {
                            setInviteToken(normalized);
                            setMessage("已从剪贴板填入邀请码");
                          } else {
                            setMessage("剪贴板里没有识别到内测邀请码");
                          }
                        } catch {
                          setMessage("无法读取剪贴板，请手动粘贴");
                        }
                      })();
                    }}
                  >
                    从剪贴板粘贴
                  </button>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[color:var(--a-brand)]"
                    onClick={() => {
                      setShowInvite(false);
                      setInviteToken("");
                    }}
                  >
                    我已有账号，不需要邀请码
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)]"
                onClick={() => setShowInvite(true)}
              >
                首次使用？填写邀请码
              </button>
            )}

            {message ? (
              <p
                className={
                  message.startsWith(ERROR_COPY.unauthenticated) ||
                  message.includes("暂未开放")
                    ? "alpha-alert alpha-alert-error"
                    : "text-sm text-[color:var(--a-muted)]"
                }
                role={
                  message.startsWith(ERROR_COPY.unauthenticated) ||
                  message.includes("暂未开放")
                    ? "alert"
                    : "status"
                }
              >
                {message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="alpha-btn alpha-btn-primary w-full"
            >
              {busy ? "请稍候…" : "获取验证码"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-5">
            <div className="space-y-1.5" role="status">
              <p className="text-sm text-[color:var(--a-muted)]">
                {ERROR_COPY.requestCodeGeneric}
              </p>
              {email.trim() ? (
                <p className="text-sm font-semibold text-[color:var(--a-ink)]">
                  验证码已发往 {maskEmail(email)}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="alpha-otp" className="alpha-label">
                验证码
              </label>
              <input
                ref={otpRef}
                id="alpha-otp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="alpha-input text-center text-xl tracking-[0.4em]"
                autoComplete="one-time-code"
              />
              <p className="mt-1.5 text-sm text-[color:var(--a-muted)]">
                {LOGIN_COPY.otpHint}
              </p>
            </div>
            {message ? (
              <p className="alpha-alert alpha-alert-error" role="alert">
                {message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="alpha-btn alpha-btn-primary w-full"
            >
              {busy ? "验证中…" : "登录"}
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => {
                if (cooldown > 0) return;
                setCode("");
                void requestCode();
              }}
              className="alpha-btn alpha-btn-ghost w-full"
            >
              {cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送验证码"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChallengeId(null);
                setCode("");
                setMessage("");
              }}
              className="alpha-btn alpha-btn-ghost w-full !text-[color:var(--a-muted)]"
            >
              返回修改邮箱
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
