"use client";

import { useCallback, useEffect, useState } from "react";
import { ROLE_LABEL, relativeTimeLabel } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";

type Access = Awaited<ReturnType<typeof v1api.getFamilyAccess>>;
type InviteRole = Access["invitableRoles"][number];

const ROLE_HINT: Record<InviteRole, string> = {
  ADMIN: "可确认资料、管理邀请",
  EDITOR: "可添加成员、关系与资料",
  VIEWER: "只能查看",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role;
}

function expiryLabel(iso: string, now = new Date()): string {
  const days = Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? "今天内有效" : `${days} 天内有效`;
}

function inviteLinkStorageKey(familyId: string, inviteId: string) {
  return `alpha-invite-link:${familyId}:${inviteId}`;
}

function readStoredInviteUrl(familyId: string, inviteId: string): string | null {
  try {
    return sessionStorage.getItem(inviteLinkStorageKey(familyId, inviteId));
  } catch {
    return null;
  }
}

function writeStoredInviteUrl(
  familyId: string,
  inviteId: string,
  url: string
) {
  try {
    sessionStorage.setItem(inviteLinkStorageKey(familyId, inviteId), url);
  } catch {
    /* private mode */
  }
}

function clearStoredInviteUrl(familyId: string, inviteId: string) {
  try {
    sessionStorage.removeItem(inviteLinkStorageKey(familyId, inviteId));
  } catch {
    /* private mode */
  }
}

export function FamilyInvites({
  familyId,
  onAuthError,
  onMembershipChanged,
}: {
  familyId: string;
  onAuthError: (e: unknown) => boolean;
  /** Refresh 最近动态 after role / remove / leave. */
  onMembershipChanged?: () => void;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [role, setRole] = useState<InviteRole>("EDITOR");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<{ url: string; role: string } | null>(null);
  const [storedUrls, setStoredUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await v1api.getFamilyAccess(familyId);
      setAccess(a);
      setRole((r) =>
        a.invitableRoles.includes(r) ? r : a.invitableRoles[0] ?? "VIEWER"
      );
      const urls: Record<string, string> = {};
      for (const inv of a.invites) {
        const u = readStoredInviteUrl(familyId, inv.id);
        if (u) urls[inv.id] = u;
      }
      setStoredUrls(urls);
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    }
  }, [familyId, onAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const trimmed = email.trim();
      const r = await v1api.createFamilyInvite(
        familyId,
        role,
        trimmed ? { email: trimmed } : undefined
      );
      const url = `${window.location.origin}/alpha/invite/${r.token}`;
      writeStoredInviteUrl(familyId, r.invite.id, url);
      setLink({
        url,
        role: r.invite.role,
      });
      if (trimmed) {
        if (r.emailDelivery === "sent") {
          setMessage("已发送邀请邮件；也可复制下方链接备用");
        } else if (r.emailDelivery === "failed") {
          setFailed(true);
          setMessage("邮件发送失败，请复制下方链接发给对方");
        } else {
          setMessage("当前环境未开通发信，请复制下方链接发给对方");
        }
      }
      await load();
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setFailed(false);
      setMessage("已复制邀请链接");
    } catch {
      setFailed(false);
      setMessage("请长按或手动选中链接复制");
    }
  }

  async function copy() {
    if (!link) return;
    await copyUrl(link.url);
  }

  async function revoke(inviteId: string) {
    try {
      await v1api.revokeFamilyInvite(familyId, inviteId);
      clearStoredInviteUrl(familyId, inviteId);
      if (link && storedUrls[inviteId] === link.url) {
        setLink(null);
      }
      setFailed(false);
      setMessage("已撤销邀请");
      await load();
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    }
  }

  async function regenerate(invite: Access["invites"][number]) {
    const nextRole = invite.role as InviteRole;
    if (!access?.invitableRoles.includes(nextRole)) {
      setFailed(true);
      setMessage("当前权限无法重新生成该角色的邀请，请撤销后另选权限生成。");
      return;
    }
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await v1api.revokeFamilyInvite(familyId, invite.id);
      clearStoredInviteUrl(familyId, invite.id);
      if (link && storedUrls[invite.id] === link.url) {
        setLink(null);
      }
      const r = await v1api.createFamilyInvite(familyId, nextRole);
      const url = `${window.location.origin}/alpha/invite/${r.token}`;
      writeStoredInviteUrl(familyId, r.invite.id, url);
      setLink({
        url,
        role: r.invite.role,
      });
      setMessage("已重新生成邀请链接，旧链接已失效");
      await load();
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(
    membershipId: string,
    next: "ADMIN" | "EDITOR" | "VIEWER"
  ) {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await v1api.updateFamilyMemberRole(familyId, membershipId, next, {
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(`已改为${roleLabel(next)}`);
      await load();
      onMembershipChanged?.();
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(membershipId: string, label: string) {
    if (!window.confirm(`确认移除「${label}」？对方将无法再打开这个家族。`)) {
      return;
    }
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await v1api.removeFamilyMember(familyId, membershipId, {
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage("已移除该账号");
      await load();
      onMembershipChanged?.();
    } catch (e) {
      if (onAuthError(e)) return;
      setFailed(true);
      setMessage(userMessageForApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!access) {
    return message ? (
      <p role="alert" className="text-sm text-[color:var(--a-danger)]">
        {message}
      </p>
    ) : null;
  }

  const counts = new Map<string, number>();
  for (const m of access.members) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);

  return (
    <section aria-labelledby="overview-invite">
      <h2
        id="overview-invite"
        className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
      >
        邀请家人
      </h2>
      <div className="alpha-panel space-y-4 px-4 py-4">
        <p className="text-sm text-[color:var(--a-muted)]">
          已有 {access.members.length} 个账号参与：
          {(["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const)
            .filter((r) => counts.get(r))
            .map((r) => `${roleLabel(r)} ${counts.get(r)}`)
            .join("、")}
          。可复制链接发给家人，也可填写邮箱尝试发送；对方登录后即可加入。每条链接只能用一次，7 天内有效。
        </p>

        <div>
          <p className="mb-2 text-sm font-semibold text-[color:var(--a-ink)]">
            已加入的账号
          </p>
          <ul
            className="divide-y divide-[color:var(--a-brand-line)] text-sm"
            aria-label="已加入的账号"
          >
            {access.members.map((m) => {
              const label =
                m.isYou
                  ? "你"
                  : m.maskedEmail ?? `账号 · ${roleLabel(m.role)}`;
              const roleOptions = access.invitableRoles.filter((r) => {
                if (access.actorRole === "OWNER") return true;
                return r !== "ADMIN";
              });
              return (
                <li
                  key={m.membershipId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[color:var(--a-ink)]">
                      {label}
                      {m.isYou && m.maskedEmail ? (
                        <span className="ml-2 font-normal text-[color:var(--a-muted)]">
                          {m.maskedEmail}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[color:var(--a-muted)]">
                      {roleLabel(m.role)}
                      {" · "}
                      {relativeTimeLabel(m.joinedAt)}加入
                    </p>
                  </div>
                  {m.manageable && !m.isYou ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`member-role-${m.membershipId}`}>
                        权限
                      </label>
                      <select
                        id={`member-role-${m.membershipId}`}
                        value={
                          roleOptions.includes(m.role as InviteRole)
                            ? m.role
                            : roleOptions[0] ?? "VIEWER"
                        }
                        disabled={busy}
                        onChange={(e) =>
                          void changeRole(
                            m.membershipId,
                            e.target.value as InviteRole
                          )
                        }
                        className="alpha-input !min-h-[32px] !w-auto !px-2 !text-xs"
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void removeMember(m.membershipId, label)
                        }
                        className="font-semibold text-[color:var(--a-danger)] underline-offset-2 hover:underline"
                      >
                        移除
                      </button>
                    </div>
                  ) : null}
                  {m.isYou && m.role !== "OWNER" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            "确认退出这个家族？退出后需再次受邀才能加入。"
                          )
                        ) {
                          return;
                        }
                        setBusy(true);
                        setMessage("");
                        setFailed(false);
                        void (async () => {
                          try {
                            await v1api.leaveFamily(familyId, {
                              idempotencyKey: crypto.randomUUID(),
                            });
                            window.location.href = "/alpha/families";
                          } catch (e) {
                            if (onAuthError(e)) return;
                            setFailed(true);
                            setMessage(userMessageForApiError(e));
                            setBusy(false);
                          }
                        })();
                      }}
                      className="font-semibold text-[color:var(--a-danger)] underline-offset-2 hover:underline"
                    >
                      退出家族
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="alpha-label">加入后的权限</span>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
              className="alpha-input !min-h-[40px] !text-sm"
            >
              {access.invitableRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}（{ROLE_HINT[r]}）
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="alpha-label">对方邮箱（可选）</span>
            <input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="例如：家人@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="alpha-input !min-h-[40px] !text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="alpha-btn alpha-btn-primary !min-h-[40px] !text-sm"
          >
            {busy ? "生成中…" : email.trim() ? "生成并发送" : "生成邀请链接"}
          </button>
        </div>

        {link ? (
          <div className="rounded-xl bg-[color:var(--a-brand-soft)]/50 px-3 py-3">
            <label htmlFor="invite-link" className="text-sm font-semibold text-[color:var(--a-brand)]">
              邀请链接（{roleLabel(link.role)}）
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="invite-link"
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                className="alpha-input !min-h-[40px] min-w-0 flex-1 !text-xs"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
              >
                复制链接
              </button>
            </div>
            <p className="mt-2 text-xs text-[color:var(--a-muted)]">
              本页刷新后仍可在下方「尚未使用的邀请」里复制（仅本浏览器会话）。对方需要已开通云族谱内测账号。
            </p>
          </div>
        ) : null}

        {access.invites.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-semibold text-[color:var(--a-ink)]">
              尚未使用的邀请
            </p>
            <ul className="divide-y divide-[color:var(--a-brand-line)] text-sm" aria-label="尚未使用的邀请">
              {access.invites.map((i) => {
                const stored = storedUrls[i.id];
                return (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2"
                  >
                    <span>
                      {roleLabel(i.role)}
                      <span className="ml-2 text-[color:var(--a-muted)]">
                        {relativeTimeLabel(i.createdAt)}生成 ·{" "}
                        {expiryLabel(i.expiresAt)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      {stored ? (
                        <button
                          type="button"
                          onClick={() => void copyUrl(stored)}
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        >
                          复制链接
                        </button>
                      ) : (
                        <>
                          <span className="text-xs text-[color:var(--a-muted)]">
                            链接不在本会话，无法再复制
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void regenerate(i)}
                            className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            重新生成链接
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => void revoke(i.id)}
                        className="font-semibold text-[color:var(--a-danger)] underline-offset-2 hover:underline"
                      >
                        撤销
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {message ? (
          <p
            role={failed ? "alert" : "status"}
            className={`text-sm ${
              failed ? "text-[color:var(--a-danger)]" : "text-[color:var(--a-brand)]"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
