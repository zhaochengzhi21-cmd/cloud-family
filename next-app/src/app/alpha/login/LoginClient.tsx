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
    <div className="mx-auto max-w-md py-8 sm:py-14">
      <p className="mb-2 text-sm font-semibold tracking-wide text-[#8a6a4a]">
        {PRODUCT.brand} Alpha
      </p>
      <h1 className="text-2xl font-bold leading-snug text-[#5c2018] sm:text-3xl">
        {LOGIN_COPY.title}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-[#6b5344]">
        {LOGIN_COPY.subtitle}
      </p>

      {!challengeId ? (
        <form onSubmit={onRequestCode} className="mt-8 space-y-5">
          <div>
            <label htmlFor="alpha-email" className="mb-1.5 block text-sm font-semibold">
              邮箱
            </label>
            <input
              id="alpha-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3 text-base outline-none focus:border-[#7a1f1f]"
            />
          </div>
          <div>
            <label htmlFor="alpha-invite" className="mb-1.5 block text-sm font-semibold">
              邀请码（首次使用时填写）
            </label>
            <input
              id="alpha-invite"
              type="text"
              autoComplete="off"
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3 text-base outline-none focus:border-[#7a1f1f]"
            />
          </div>
          {message ? (
            <p className="text-sm text-[#6b5344]" role="status">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#7a1f1f] px-4 text-base font-bold text-white disabled:opacity-60"
          >
            {busy ? "请稍候…" : "获取验证码"}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="mt-8 space-y-5">
          <p className="text-sm text-[#6b5344]" role="status">
            {ERROR_COPY.requestCodeGeneric}
          </p>
          <div>
            <label htmlFor="alpha-otp" className="mb-1.5 block text-sm font-semibold">
              验证码
            </label>
            <input
              id="alpha-otp"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full min-h-[44px] rounded-xl border border-[#d4a76a]/50 bg-white px-3 text-center text-xl tracking-[0.4em] outline-none focus:border-[#7a1f1f]"
            />
            <p className="mt-1.5 text-sm text-[#8a6a4a]">{LOGIN_COPY.otpHint}</p>
          </div>
          {message ? (
            <p className="text-sm text-[#7a1f1f]" role="alert">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#7a1f1f] px-4 text-base font-bold text-white disabled:opacity-60"
          >
            {busy ? "验证中…" : "登录"}
          </button>
          <button
            type="button"
            disabled={busy || cooldown > 0}
            onClick={() => {
              setChallengeId(null);
              setCode("");
              setMessage("");
            }}
            className="inline-flex min-h-[44px] w-full items-center justify-center text-sm font-semibold text-[#8a6a4a] disabled:opacity-50"
          >
            {cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送"}
          </button>
        </form>
      )}
    </div>
  );
}
