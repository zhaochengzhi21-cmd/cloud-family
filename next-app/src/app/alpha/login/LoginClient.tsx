"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ERROR_COPY, LOGIN_COPY, PRODUCT } from "@/v1/ui/copy";
import { v1api, V1ApiError } from "@/v1/client/api";

export default function AlphaLoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const expired = search.get("reason") === "expired";

  const [email, setEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(
    expired ? ERROR_COPY.unauthenticated : ""
  );
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  async function onRequestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const body: { email: string; inviteToken?: string } = {
        email: email.trim(),
      };
      if (inviteToken.trim()) body.inviteToken = inviteToken.trim();
      const res = await v1api.requestCode(body);
      setChallengeId(res.challengeId ?? "pending");
      setMessage(ERROR_COPY.requestCodeGeneric);
      setCooldown(60);
      const t = window.setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            window.clearInterval(t);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
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

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!challengeId || challengeId === "pending") {
      setMessage(ERROR_COPY.verifyFailed);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await v1api.verify({ challengeId, code: code.trim() });
      router.replace("/alpha/families");
    } catch {
      setMessage(ERROR_COPY.verifyFailed);
    } finally {
      setBusy(false);
    }
  }

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
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="alpha-input"
              />
            </div>
            <div>
              <label htmlFor="alpha-invite" className="alpha-label">
                邀请码（首次使用时填写）
              </label>
              <input
                id="alpha-invite"
                type="text"
                autoComplete="off"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                className="alpha-input"
              />
            </div>
            {message ? (
              <p className="text-sm text-[color:var(--a-muted)]" role="status">
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
            <p className="text-sm text-[color:var(--a-muted)]" role="status">
              {ERROR_COPY.requestCodeGeneric}
            </p>
            <div>
              <label htmlFor="alpha-otp" className="alpha-label">
                验证码
              </label>
              <input
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
            onClick={async () => {
              if (cooldown > 0) return;
              setCode("");
              setMessage("");
              setBusy(true);
              try {
                const body: { email: string; inviteToken?: string } = {
                  email: email.trim(),
                };
                if (inviteToken.trim()) body.inviteToken = inviteToken.trim();
                const res = await v1api.requestCode(body);
                setChallengeId(res.challengeId ?? "pending");
                setMessage(ERROR_COPY.requestCodeGeneric);
                setCooldown(60);
                const t = window.setInterval(() => {
                  setCooldown((c) => {
                    if (c <= 1) {
                      window.clearInterval(t);
                      return 0;
                    }
                    return c - 1;
                  });
                }, 1000);
              } catch (err) {
                if (err instanceof V1ApiError && err.status === 404) {
                  setMessage("当前环境暂未开放登录。");
                } else {
                  setMessage(ERROR_COPY.requestCodeGeneric);
                }
              } finally {
                setBusy(false);
              }
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
