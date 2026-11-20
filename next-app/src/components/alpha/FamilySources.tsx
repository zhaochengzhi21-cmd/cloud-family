"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CLAIM_TYPE_UI, EVIDENCE_TYPE_UI } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";

type Item = Awaited<ReturnType<typeof v1api.listEvidence>>["evidence"][number];
type EvidenceLink = Awaited<
  ReturnType<typeof v1api.listEvidenceLinks>
>["links"][number];

function isAudio(mime: string | null, type: string) {
  return Boolean(mime?.startsWith("audio/")) || type === "ORAL_HISTORY";
}

function isPhoto(mime: string | null, type: string) {
  return Boolean(mime?.startsWith("image/")) || type === "PHOTO";
}

export function FamilySources({
  familyId,
  onAuthError,
  onOpenRecords,
  canManage = false,
  onRemoved,
  focusEvidenceId = null,
  onFocusEvidenceConsumed,
  dataVersion = 0,
}: {
  familyId: string;
  onAuthError: (e: unknown) => boolean;
  onOpenRecords?: (
    personId: string,
    opts?: {
      focusClaimId?: string;
      statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
    }
  ) => void;
  /** OWNER/ADMIN — soft-delete from the library. */
  canManage?: boolean;
  onRemoved?: () => void;
  focusEvidenceId?: string | null;
  onFocusEvidenceConsumed?: () => void;
  /** Bumps when the workspace reloads so the library stays in sync. */
  dataVersion?: number;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | "AUDIO" | "PHOTO" | "DOC">(
    "ALL"
  );
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [playing, setPlaying] = useState<{
    id: string;
    url: string;
    title: string;
  } | null>(null);
  const [viewer, setViewer] = useState<{
    id: string;
    url: string;
    title: string;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [linksById, setLinksById] = useState<Record<string, EvidenceLink[]>>(
    {}
  );
  const [linksLoadingId, setLinksLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await v1api.listEvidence(familyId);
      setItems(r.evidence);
    } catch (e) {
      if (onAuthError(e)) return;
      setError(userMessageForApiError(e));
    }
  }, [familyId, onAuthError]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const shown = useMemo(() => {
    if (!items) return [];
    if (filter === "PHOTO") {
      return items.filter((e) => isPhoto(e.mimeType, e.evidenceType));
    }
    if (filter === "AUDIO") {
      return items.filter((e) => isAudio(e.mimeType, e.evidenceType));
    }
    if (filter === "DOC") {
      return items.filter(
        (e) =>
          e.evidenceType === "DOCUMENT" ||
          e.evidenceType === "GENEALOGY_PAGE" ||
          e.evidenceType === "ARCHIVE"
      );
    }
    return items;
  }, [items, filter]);

  async function openMedia(
    item: Item,
    kind: "audio" | "photo" | "file"
  ) {
    if (!item.mediaObjectId) return;
    try {
      const r = await v1api.mediaRead(familyId, item.mediaObjectId);
      const mime = r.media.mimeType ?? "";
      const title =
        item.title ||
        EVIDENCE_TYPE_UI[item.evidenceType] ||
        (kind === "audio" ? "口述录音" : kind === "photo" ? "照片" : "附件");
      if (kind === "file") {
        if (mime.startsWith("image/")) {
          setPlaying(null);
          setViewer({ id: item.id, url: r.read.url, title });
          return;
        }
        if (mime.startsWith("audio/")) {
          setViewer(null);
          setPlaying({ id: item.id, url: r.read.url, title });
          return;
        }
        window.open(r.read.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (kind === "audio") {
        setViewer(null);
        setPlaying({ id: item.id, url: r.read.url, title });
      } else {
        setPlaying(null);
        setViewer({ id: item.id, url: r.read.url, title });
      }
    } catch (e) {
      if (onAuthError(e)) return;
      setError(userMessageForApiError(e));
    }
  }

  async function toggleLinks(evidenceId: string) {
    if (expandedId === evidenceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(evidenceId);
    if (linksById[evidenceId]) return;
    setLinksLoadingId(evidenceId);
    try {
      const r = await v1api.listEvidenceLinks(familyId, evidenceId);
      setLinksById((prev) => ({ ...prev, [evidenceId]: r.links }));
    } catch (e) {
      if (onAuthError(e)) return;
      setError(userMessageForApiError(e));
      setExpandedId(null);
    } finally {
      setLinksLoadingId(null);
    }
  }

  useEffect(() => {
    if (!focusEvidenceId) return;
    let cancelled = false;
    const focusId = focusEvidenceId;
    (async () => {
      // Always refetch so restore / create paths see the latest library.
      let list = items;
      try {
        const r = await v1api.listEvidence(familyId);
        if (cancelled) return;
        setItems(r.evidence);
        list = r.evidence;
      } catch (e) {
        if (onAuthError(e)) return;
        if (!cancelled) setError(userMessageForApiError(e));
        onFocusEvidenceConsumed?.();
        return;
      }
      const item = list?.find((e) => e.id === focusId);
      if (!item) {
        onFocusEvidenceConsumed?.();
        return;
      }
      setFilter("ALL");
      window.setTimeout(() => {
        if (cancelled) return;
        const el = document.querySelector(`[data-evidence-id="${focusId}"]`);
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.classList.add("ring-2", "ring-[color:var(--a-brand)]");
          window.setTimeout(() => {
            el.classList.remove("ring-2", "ring-[color:var(--a-brand)]");
          }, 2400);
        }
        if (item.mediaObjectId) {
          if (isPhoto(item.mimeType, item.evidenceType)) {
            void openMedia(item, "photo");
          } else if (isAudio(item.mimeType, item.evidenceType)) {
            void openMedia(item, "audio");
          } else {
            void openMedia(item, "file");
          }
        } else if (
          item.description ||
          item.sourceDateText ||
          item.sourceLocator
        ) {
          setDetailId(item.id);
        }
        onFocusEvidenceConsumed?.();
      }, 50);
    })();
    return () => {
      cancelled = true;
    };
    // openMedia is stable enough for this focus path; avoid re-firing on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEvidenceId, familyId, onAuthError, onFocusEvidenceConsumed]);

  if (error && !items) {
    return (
      <p role="alert" className="text-sm text-[color:var(--a-danger)]">
        {error}
      </p>
    );
  }
  if (!items) return null;

  return (
    <section aria-labelledby="overview-sources">
      <h2
        id="overview-sources"
        className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
      >
        资料来源库
      </h2>
      <div className="alpha-panel px-4 py-4">
        <p className="text-sm text-[color:var(--a-muted)]">
          家族里已收录的出处。添加人物资料时可以选择「使用已有来源」，不必重复上传。
        </p>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-[color:var(--a-muted)]">
            还没有资料来源。打开某位家人的资料，添加谱页、照片或口述出处后，会汇总到这里。
          </p>
        ) : null}
        {items.length > 0 ? (
        <>
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="来源筛选"
        >
          {(
            [
              ["ALL", "全部"],
              ["PHOTO", "照片"],
              ["AUDIO", "口述 / 录音"],
              ["DOC", "谱页 / 文书"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`alpha-chip !min-h-[32px] font-semibold ${
                filter === k ? "!bg-[color:var(--a-brand-soft)]" : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-[color:var(--a-muted)]">
            这一类还没有来源。
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[color:var(--a-brand-line)]" aria-label="资料来源列表">
            {shown.map((e) => (
              <li
                key={e.id}
                data-evidence-id={e.id}
                className="rounded-lg py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[color:var(--a-ink)]">
                      {EVIDENCE_TYPE_UI[e.evidenceType] ?? "来源"}
                      {e.title ? ` · ${e.title}` : ""}
                    </p>
                    <p className="text-xs text-[color:var(--a-muted)]">
                      {e.sourceLocator ? `${e.sourceLocator} · ` : ""}
                      {e.linkCount > 0 && onOpenRecords ? (
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                          aria-expanded={expandedId === e.id}
                          onClick={() => void toggleLinks(e.id)}
                        >
                          已用于 {e.linkCount} 条资料
                        </button>
                      ) : (
                        <>已用于 {e.linkCount} 条资料</>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {e.description || e.sourceDateText ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        aria-expanded={detailId === e.id}
                        onClick={() =>
                          setDetailId((id) => (id === e.id ? null : e.id))
                        }
                      >
                        详情
                      </button>
                    ) : null}
                    {e.mediaObjectId && isAudio(e.mimeType, e.evidenceType) ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        onClick={() => void openMedia(e, "audio")}
                      >
                        收听
                      </button>
                    ) : null}
                    {e.mediaObjectId && isPhoto(e.mimeType, e.evidenceType) ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        onClick={() => void openMedia(e, "photo")}
                      >
                        查看
                      </button>
                    ) : null}
                    {e.mediaObjectId &&
                    !isPhoto(e.mimeType, e.evidenceType) &&
                    !isAudio(e.mimeType, e.evidenceType) ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        onClick={() => void openMedia(e, "file")}
                      >
                        打开
                      </button>
                    ) : null}
                    {canManage ? (
                      removingId === e.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[color:var(--a-danger)]">
                            {e.linkCount > 1
                              ? `用于 ${e.linkCount} 条资料，确认从库中移除？`
                              : "确认移除？"}
                          </span>
                          <button
                            type="button"
                            className="font-semibold text-[color:var(--a-muted)]"
                            disabled={removingBusy}
                            onClick={() => setRemovingId(null)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="font-semibold text-[color:var(--a-danger)] hover:underline"
                            disabled={removingBusy}
                            onClick={async () => {
                              setRemovingBusy(true);
                              try {
                                await v1api.deleteEvidence(familyId, e.id, {
                                  idempotencyKey: crypto.randomUUID(),
                                });
                                setRemovingId(null);
                                await load();
                                onRemoved?.();
                              } catch (err) {
                                if (onAuthError(err)) return;
                                setError(userMessageForApiError(err));
                                setRemovingId(null);
                              } finally {
                                setRemovingBusy(false);
                              }
                            }}
                          >
                            {removingBusy ? "移除中…" : "确认移除"}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="font-semibold text-[color:var(--a-muted)] hover:text-[color:var(--a-danger)]"
                          onClick={() => setRemovingId(e.id)}
                        >
                          移除
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
                {detailId === e.id ? (
                  <div className="mt-2 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-2 text-xs text-[color:var(--a-muted)]">
                    {e.description ? (
                      <p className="whitespace-pre-wrap text-[color:var(--a-ink)]">
                        {e.description}
                      </p>
                    ) : null}
                    {e.sourceDateText ? (
                      <p className={e.description ? "mt-1" : undefined}>
                        年代 / 日期：{e.sourceDateText}
                      </p>
                    ) : null}
                    {e.sourceLocator ? (
                      <p
                        className={
                          e.description || e.sourceDateText ? "mt-1" : undefined
                        }
                      >
                        出处：{e.sourceLocator}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {expandedId === e.id ? (
                  <div className="mt-2">
                    {linksLoadingId === e.id ? (
                      <p className="text-xs text-[color:var(--a-muted)]">
                        正在加载关联资料…
                      </p>
                    ) : (linksById[e.id] ?? []).length === 0 ? (
                      <p className="text-xs text-[color:var(--a-muted)]">
                        暂无可见的关联资料。
                      </p>
                    ) : (
                      <div
                        className="flex flex-wrap gap-2"
                        role="group"
                        aria-label="关联资料"
                      >
                        {(linksById[e.id] ?? []).map((link) => {
                          const typeLabel =
                            CLAIM_TYPE_UI[link.claimType]?.label ??
                            link.claimType;
                          return (
                            <button
                              key={link.claimId}
                              type="button"
                              className="alpha-btn alpha-btn-secondary !min-h-[32px] !px-3 !text-xs"
                              onClick={() =>
                                onOpenRecords?.(link.personId, {
                                  focusClaimId: link.claimId,
                                  statusFilter:
                                    link.status === "CONFLICTED"
                                      ? "CONFLICTED"
                                      : link.status === "PROPOSED"
                                        ? "PROPOSED"
                                        : "ALL",
                                })
                              }
                            >
                              {link.personName} · {typeLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        </>
        ) : null}
        {playing ? (
          <div className="mt-3 rounded-xl bg-[color:var(--a-brand-soft)]/50 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[color:var(--a-brand)]">
                {playing.title}
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-muted)]"
                onClick={() => setPlaying(null)}
              >
                关闭
              </button>
            </div>
            <audio
              key={playing.id}
              controls
              autoPlay
              src={playing.url}
              className="w-full"
            >
              你的浏览器不支持音频播放。
            </audio>
          </div>
        ) : null}
        {viewer ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={viewer.title}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setViewer(null)}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-[color:var(--a-ink)]"
              onClick={() => setViewer(null)}
            >
              关闭
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewer.url}
              alt={viewer.title}
              className="max-h-[90vh] max-w-full rounded-lg object-contain"
              onClick={(ev) => ev.stopPropagation()}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-[color:var(--a-danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
