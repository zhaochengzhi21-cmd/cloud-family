"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRODUCT, ROLE_LABEL } from "@/v1/ui/copy";
import { userMessageForApiError, v1api, V1ApiError } from "@/v1/client/api";

type Preview = Awaited<ReturnType<typeof v1api.previewInvite>>["invite"];

type View =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "preview"; invite: Preview };

function roleLabel(role: string | null): string {
  return (role && ROLE_LABEL[role as keyof typeof ROLE_LABEL]) || "成员";
}

function AlreadyMemberCopyButton({ familyId }: { familyId: string }) {
  const [flash, setFlash] = useState("");
  return (
    <button
      type="button"
      className="alpha-btn alpha-btn-secondary inline-flex"
      onClick={() => {
        const url = `${window.location.origin}/alpha/families/${familyId}`;
        void navigator.clipboard.writeText(url).then(
          () => {
            setFlash("已复制家族链接");
            window.setTimeout(() => setFlash(""), 2500);
          },
          () => {
            setFlash("请手动复制地址栏链接");
            window.setTimeout(() => setFlash(""), 2500);
          }
        );
      }}
    >
      {flash || "复制家族链接"}
    </button>
  );
}

function UnavailableInviteCopyButton() {
  const [flash, setFlash] = useState("");
  return (
    <button
      type="button"
      className="alpha-btn alpha-btn-secondary inline-flex"
      onClick={() => {
        const url = `${window.location.origin}/alpha/families`;
        void navigator.clipboard.writeText(url).then(
          () => {
            setFlash("已复制「我的家族」链接");
            window.setTimeout(() => setFlash(""), 2500);
          },
          () => {
            setFlash("请手动复制地址栏链接");
            window.setTimeout(() => setFlash(""), 2500);
          }
        );
      }}
    >
      {flash || "复制「我的家族」链接"}
    </button>
  );
}

export function InviteLanding({ token }: { token: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = `家族邀请 · ${PRODUCT.brand}`;
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    v1api
      .previewInvite(token)
      .then((r) => {
        if (!cancelled) setView({ kind: "preview", invite: r.invite });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof V1ApiError && e.status === 401) {
          router.replace(
            `/alpha/login?next=${encodeURIComponent(`/alpha/invite/${token}`)}`
          );
          return;
        }
        if (e instanceof V1ApiError && e.status === 404) {
          setView({ kind: "invalid" });
          return;
        }
        setView({ kind: "error", message: userMessageForApiError(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  async function accept() {
    setBusy(true);
    try {
      const r = await v1api.acceptInvite(token);
      router.replace(`/alpha/families/${r.membership.familyId}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof V1ApiError && e.status === 410) {
        setView({
          kind: "preview",
          invite: { status: "UNAVAILABLE", familyId: null, familyName: null, role: null },
        });
        return;
      }
      if (e instanceof V1ApiError && e.status === 404) {
        setView({ kind: "invalid" });
        return;
      }
      setView({ kind: "error", message: userMessageForApiError(e) });
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="alpha-panel px-6 py-8 text-center">
        {view.kind === "loading" ? (
          <p role="status" className="text-[color:var(--a-muted)]">
            正在查看邀请…
          </p>
        ) : null}

        {view.kind === "invalid" ? (
          <>
            <h1 className="alpha-font-display text-2xl font-bold text-[color:var(--a-ink)]">
              邀请链接无效
            </h1>
            <p className="mt-3 text-sm text-[color:var(--a-muted)]">
              请确认链接完整，或向家人要一条新的邀请链接；也可复制「我的家族」页发给对方。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link
                href="/alpha/families"
                className="alpha-btn alpha-btn-primary inline-flex"
              >
                查看我的家族
              </Link>
              <UnavailableInviteCopyButton />
            </div>
          </>
        ) : null}

        {view.kind === "error" ? (
          <>
            <p role="alert" className="text-[color:var(--a-danger)]">
              {view.message}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="alpha-btn alpha-btn-primary inline-flex"
                onClick={() => {
                  setView({ kind: "loading" });
                  void v1api
                    .previewInvite(token)
                    .then((r) => setView({ kind: "preview", invite: r.invite }))
                    .catch((e) => {
                      if (e instanceof V1ApiError && e.status === 401) {
                        router.replace(
                          `/alpha/login?next=${encodeURIComponent(`/alpha/invite/${token}`)}`
                        );
                        return;
                      }
                      if (e instanceof V1ApiError && e.status === 404) {
                        setView({ kind: "invalid" });
                        return;
                      }
                      setView({
                        kind: "error",
                        message: userMessageForApiError(e),
                      });
                    });
                }}
              >
                重试
              </button>
              <Link
                href="/alpha/families"
                className="alpha-btn alpha-btn-secondary inline-flex"
              >
                查看我的家族
              </Link>
              <UnavailableInviteCopyButton />
            </div>
          </>
        ) : null}

        {view.kind === "preview" && view.invite.status === "UNAVAILABLE" ? (
          <>
            <h1 className="alpha-font-display text-2xl font-bold text-[color:var(--a-ink)]">
              这条邀请已失效
            </h1>
            <p className="mt-3 text-sm text-[color:var(--a-muted)]">
              它可能已被使用、被撤销或已过期。请向家人要一条新的邀请链接；也可复制「我的家族」页发给对方，方便对方从参与家人处再发邀请。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link
                href="/alpha/families"
                className="alpha-btn alpha-btn-primary inline-flex"
              >
                查看我的家族
              </Link>
              <UnavailableInviteCopyButton />
            </div>
          </>
        ) : null}

        {view.kind === "preview" && view.invite.status === "ALREADY_MEMBER" ? (
          <>
            <h1 className="alpha-font-display text-2xl font-bold text-[color:var(--a-ink)]">
              你已经是「{view.invite.familyName}」的成员
            </h1>
            <p className="mt-3 text-sm text-[color:var(--a-muted)]">
              当前权限：{roleLabel(view.invite.role)}
              。可复制家族链接发给其他家人，或直接打开档案。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link
                href={`/alpha/families/${view.invite.familyId}`}
                className="alpha-btn alpha-btn-primary inline-flex"
              >
                打开家族档案
              </Link>
              {view.invite.familyId ? (
                <AlreadyMemberCopyButton
                  familyId={view.invite.familyId}
                />
              ) : null}
            </div>
          </>
        ) : null}

        {view.kind === "preview" && view.invite.status === "OPEN" ? (
          <>
            <p className="text-sm font-semibold tracking-wide text-[color:var(--a-brand)]">
              家族邀请
            </p>
            <h1 className="alpha-font-display mt-2 text-2xl font-bold text-[color:var(--a-ink)]">
              {view.invite.rejoining
                ? `重新加入「${view.invite.familyName}」`
                : `加入「${view.invite.familyName}」`}
            </h1>
            <p className="mt-3 text-sm text-[color:var(--a-muted)]">
              {view.invite.rejoining
                ? `你曾离开或被移出过这个家族。确认后将按「${roleLabel(view.invite.role)}」重新加入，可以和家人一起查看${view.invite.role === "VIEWER" ? "" : "、补充"}家族档案。`
                : `加入后你的权限是「${roleLabel(view.invite.role)}」，可以和家人一起查看${view.invite.role === "VIEWER" ? "" : "、补充"}家族档案。`}
            </p>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={busy}
              className="alpha-btn alpha-btn-primary mt-6"
            >
              {busy
                ? view.invite.rejoining
                  ? "正在重新加入…"
                  : "正在加入…"
                : view.invite.rejoining
                  ? "重新加入家族"
                  : "加入家族"}
            </button>
          </>
        ) : null}

        {view.kind !== "loading" ? (
          <p className="mt-6">
            <Link
              href="/alpha/families"
              className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
            >
              我的家族
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
