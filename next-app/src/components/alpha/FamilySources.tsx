"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { upload } from "@vercel/blob/client";
import { CLAIM_TYPE_UI, EVIDENCE_TYPE_UI, REVIEWER_CONTACT } from "@/v1/ui/copy";
import { userMessageForApiError, v1api } from "@/v1/client/api";
import { MEDIA_MAX_BYTES } from "@/v1/domain/media/types";

type Item = Awaited<ReturnType<typeof v1api.listEvidence>>["evidence"][number];
type EvidenceLink = Awaited<
  ReturnType<typeof v1api.listEvidenceLinks>
>["links"][number];

const ALLOWED_EXT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".mov",
];

function mimeFromFile(file: File): string | null {
  if (file.type && Object.keys(MEDIA_MAX_BYTES).includes(file.type)) {
    return file.type;
  }
  const n = file.name.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  return null;
}

function isAudio(mime: string | null, type: string) {
  return Boolean(mime?.startsWith("audio/")) || type === "ORAL_HISTORY";
}

function isPhoto(mime: string | null, type: string) {
  return Boolean(mime?.startsWith("image/")) || type === "PHOTO";
}

type LibraryFilter = "ALL" | "AUDIO" | "PHOTO" | "DOC";

function seedTypeForFilter(filter: LibraryFilter): string {
  if (filter === "PHOTO") return "PHOTO";
  if (filter === "AUDIO") return "ORAL_HISTORY";
  if (filter === "DOC") return "GENEALOGY_PAGE";
  return "GENEALOGY_PAGE";
}

const FILTER_ADD_LABEL: Record<Exclude<LibraryFilter, "ALL">, string> = {
  PHOTO: "收录照片",
  AUDIO: "收录口述 / 录音",
  DOC: "收录谱页 / 文书",
};

export function FamilySources({
  familyId,
  persons = [],
  onAuthError,
  onOpenRecords,
  onAddPerson,
  canEdit = false,
  canManage = false,
  onRemoved,
  onCreated,
  onLinked,
  focusEvidenceId = null,
  onFocusEvidenceConsumed,
  onOpenParticipants,
  dataVersion = 0,
}: {
  familyId: string;
  persons?: Array<{ id: string; preferredName: string }>;
  onAuthError: (e: unknown) => boolean;
  onOpenRecords?: (
    personId: string,
    opts?: {
      claimType?: string;
      focusClaimId?: string;
      statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
    }
  ) => void;
  /** When the family has no members, offer a path to add one before attach. */
  onAddPerson?: () => void;
  /** EDITOR+ — park a source in the library without attaching a claim. */
  canEdit?: boolean;
  /** OWNER/ADMIN — soft-delete from the library. */
  canManage?: boolean;
  onRemoved?: (evidenceId: string, label: string) => void;
  onCreated?: () => void;
  onLinked?: () => void;
  focusEvidenceId?: string | null;
  onFocusEvidenceConsumed?: () => void;
  /** Non-managers: jump to 参与家人 when a focused source is missing. */
  onOpenParticipants?: () => void;
  /** Bumps when the workspace reloads so the library stays in sync. */
  dataVersion?: number;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("ALL");
  const [addSeedType, setAddSeedType] = useState("GENEALOGY_PAGE");
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
  const [adding, setAdding] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachFlash, setAttachFlash] = useState<{
    message: string;
    url: string;
    personId: string;
    claimId: string;
    evidenceId?: string;
  } | null>(null);
  const [attachCopyFlash, setAttachCopyFlash] = useState("");
  const [focusMissId, setFocusMissId] = useState<string | null>(null);
  const [focusRestoreBusy, setFocusRestoreBusy] = useState(false);
  const [copyFlash, setCopyFlash] = useState<{
    id: string;
    ok: boolean;
  } | null>(null);

  async function copyEvidenceLink(evidenceId: string) {
    const url = `${window.location.origin}/alpha/families/${familyId}?evidence=${encodeURIComponent(evidenceId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFlash({ id: evidenceId, ok: true });
    } catch {
      setCopyFlash({ id: evidenceId, ok: false });
    }
    window.setTimeout(() => {
      setCopyFlash((cur) => (cur?.id === evidenceId ? null : cur));
    }, 2500);
  }

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
        setFocusMissId(focusId);
        onFocusEvidenceConsumed?.();
        return;
      }
      setFocusMissId(null);
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
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-[color:var(--a-danger)]">
          {error}
        </p>
        <button
          type="button"
          className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
          onClick={() => void load()}
        >
          重试
        </button>
      </div>
    );
  }
  if (!items) return null;

  return (
    <section id="overview-sources-section" aria-labelledby="overview-sources">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2
          id="overview-sources"
          className="text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          资料来源库
        </h2>
        <button
          type="button"
          className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
          onClick={() => {
            const url = `${window.location.origin}/alpha/families/${familyId}?scroll=sources`;
            void navigator.clipboard.writeText(url).then(
              () => setCopyFlash({ id: "section", ok: true }),
              () => setCopyFlash({ id: "section", ok: false })
            );
            window.setTimeout(() => {
              setCopyFlash((cur) => (cur?.id === "section" ? null : cur));
            }, 2500);
          }}
        >
          {copyFlash?.id === "section"
            ? copyFlash.ok
              ? "已复制链接"
              : "请手动复制"
            : "复制本段链接"}
        </button>
      </div>
      <div className="alpha-panel px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-[color:var(--a-muted)]">
            家族里已收录的出处。可先在这里收录，添加人物资料时再选择「使用已有来源」。
          </p>
          {canEdit && !adding ? (
            <button
              type="button"
              className="alpha-btn alpha-btn-primary !min-h-[40px] shrink-0 !px-3 !text-sm"
              onClick={() => {
                setAddSeedType(seedTypeForFilter(filter));
                setAdding(true);
              }}
            >
              收录来源
            </button>
          ) : null}
        </div>
        {persons.length === 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-3">
            <p className="text-sm text-[color:var(--a-muted)]">
              {canEdit
                ? "还没有成员，来源仍可收录与查看；挂到人物资料需先添加家人。"
                : "还没有成员。有编辑权限的家人添加成员后，才可把来源挂到人物资料。可复制添加链接发给对方。"}
            </p>
            {canEdit && onAddPerson ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={onAddPerson}
              >
                去添加成员
              </button>
            ) : null}
            {!canEdit ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  const qs = new URLSearchParams({
                    tab: "members",
                    add: "person",
                  });
                  const url = `${window.location.origin}/alpha/families/${familyId}?${qs.toString()}`;
                  void navigator.clipboard.writeText(url).then(
                    () => setCopyFlash({ id: "add-person", ok: true }),
                    () => setCopyFlash({ id: "add-person", ok: false })
                  );
                  window.setTimeout(() => {
                    setCopyFlash((cur) =>
                      cur?.id === "add-person" ? null : cur
                    );
                  }, 2500);
                }}
              >
                {copyFlash?.id === "add-person"
                  ? copyFlash.ok
                    ? "已复制链接"
                    : "请手动复制"
                  : "复制添加成员链接"}
              </button>
            ) : null}
            {!canEdit && onOpenParticipants ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={onOpenParticipants}
              >
                查看参与家人
              </button>
            ) : null}
          </div>
        ) : null}
        {adding && canEdit ? (
          <LibraryAddSourceForm
            key={addSeedType}
            familyId={familyId}
            initialEvidenceType={addSeedType}
            onAuthError={onAuthError}
            onCancel={() => setAdding(false)}
            onDone={async (created) => {
              setAdding(false);
              const qs = new URLSearchParams({
                tab: "overview",
                scroll: "sources",
                evidence: created.evidenceId,
              });
              setAttachFlash({
                message:
                  "已收录资料来源。可复制链接发给家人，或挂到人物资料。",
                url: `${window.location.origin}/alpha/families/${familyId}?${qs.toString()}`,
                personId: "",
                claimId: "",
                evidenceId: created.evidenceId,
              });
              setAttachCopyFlash("");
              await load();
              onCreated?.();
            }}
          />
        ) : null}
        {attachFlash ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-3"
            role="status"
          >
            <p className="text-sm text-[color:var(--a-muted)]">
              {attachFlash.message}
            </p>
            {attachFlash.personId && attachFlash.claimId ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  if (onOpenRecords) {
                    onOpenRecords(attachFlash.personId, {
                      focusClaimId: attachFlash.claimId,
                    });
                    setAttachFlash(null);
                    return;
                  }
                  window.location.assign(attachFlash.url);
                }}
              >
                打开人物资料
              </button>
            ) : attachFlash.evidenceId && canEdit ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  setAttachingId(attachFlash.evidenceId!);
                  setAttachFlash(null);
                  window.setTimeout(() => {
                    const el = document.querySelector(
                      `[data-evidence-id="${attachFlash.evidenceId}"]`
                    );
                    if (el instanceof HTMLElement) {
                      el.scrollIntoView({ block: "center", behavior: "smooth" });
                    }
                  }, 80);
                }}
              >
                挂到人物资料
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
              onClick={() => {
                void navigator.clipboard.writeText(attachFlash.url).then(
                  () => {
                    setAttachCopyFlash("已复制链接");
                    window.setTimeout(() => setAttachCopyFlash(""), 2500);
                  },
                  () => {
                    setAttachCopyFlash("请手动复制地址栏链接");
                    window.setTimeout(() => setAttachCopyFlash(""), 2500);
                  }
                );
              }}
            >
              {attachCopyFlash || "复制链接"}
            </button>
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-muted)] underline-offset-2 hover:underline"
              onClick={() => setAttachFlash(null)}
            >
              关闭
            </button>
          </div>
        ) : null}
        {focusMissId ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[color:var(--a-brand-soft)]/40 px-3 py-3"
            role="status"
          >
            <p className="text-sm text-[color:var(--a-muted)]">
              这条来源已不在资料来源库中
              {canManage
                ? "，可能刚被移除。"
                : `。若需找回，可复制链接发给${REVIEWER_CONTACT}恢复。`}
            </p>
            {canManage ? (
              <button
                type="button"
                disabled={focusRestoreBusy}
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  const id = focusMissId;
                  setFocusRestoreBusy(true);
                  void (async () => {
                    try {
                      await v1api.restoreEvidence(familyId, id, {
                        idempotencyKey: crypto.randomUUID(),
                      });
                      setFocusMissId(null);
                      const qs = new URLSearchParams({
                        tab: "overview",
                        scroll: "sources",
                        evidence: id,
                      });
                      setAttachFlash({
                        message:
                          "已恢复这条资料来源。可复制链接发给家人一起看。",
                        url: `${window.location.origin}/alpha/families/${familyId}?${qs.toString()}`,
                        personId: "",
                        claimId: "",
                        evidenceId: id,
                      });
                      setAttachCopyFlash("");
                      await load();
                      onCreated?.();
                      onLinked?.();
                      window.setTimeout(() => {
                        const el = document.querySelector(
                          `[data-evidence-id="${id}"]`
                        );
                        if (el instanceof HTMLElement) {
                          el.scrollIntoView({
                            block: "center",
                            behavior: "smooth",
                          });
                          el.classList.add(
                            "ring-2",
                            "ring-[color:var(--a-brand)]"
                          );
                          window.setTimeout(() => {
                            el.classList.remove(
                              "ring-2",
                              "ring-[color:var(--a-brand)]"
                            );
                          }, 2400);
                        }
                      }, 80);
                    } catch (e) {
                      if (onAuthError(e)) return;
                      setError(userMessageForApiError(e));
                      setFocusMissId(null);
                    } finally {
                      setFocusRestoreBusy(false);
                    }
                  })();
                }}
              >
                {focusRestoreBusy ? "恢复中…" : "恢复这条来源"}
              </button>
            ) : null}
            {!canManage ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => void copyEvidenceLink(focusMissId)}
              >
                {copyFlash?.id === focusMissId
                  ? copyFlash.ok
                    ? "已复制链接"
                    : "请手动复制地址栏"
                  : "复制链接发给家人"}
              </button>
            ) : null}
            {!canManage && onOpenParticipants ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  setFocusMissId(null);
                  onOpenParticipants();
                }}
              >
                查看参与家人
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm font-semibold text-[color:var(--a-muted)] underline-offset-2 hover:underline"
              onClick={() => setFocusMissId(null)}
            >
              知道了
            </button>
          </div>
        ) : null}
        {items.length === 0 && !adding ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-[color:var(--a-muted)]">
              {canEdit
                ? "还没有资料来源。点「收录来源」先放入谱页、照片或口述出处；之后挂到人物资料时不必重复上传。"
                : "还没有资料来源。有编辑权限的家人收录后，会汇总到这里。可复制上方本段链接发给对方。"}
            </p>
            {!canEdit && onOpenParticipants ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={onOpenParticipants}
              >
                查看参与家人
              </button>
            ) : null}
          </div>
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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-[color:var(--a-muted)]">
              这一类还没有来源。
            </p>
            {filter !== "ALL" && canEdit && !adding ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => {
                  setAddSeedType(seedTypeForFilter(filter));
                  setAdding(true);
                }}
              >
                {FILTER_ADD_LABEL[filter]}
              </button>
            ) : null}
            {filter !== "ALL" ? (
              <button
                type="button"
                className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => setFilter("ALL")}
              >
                查看全部
              </button>
            ) : null}
          </div>
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
                      {e.sourceDateText ? `${e.sourceDateText} · ` : ""}
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
                    <button
                      type="button"
                      className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                      onClick={() => void copyEvidenceLink(e.id)}
                    >
                      {copyFlash?.id === e.id
                        ? copyFlash.ok
                          ? "已复制链接"
                          : "请手动复制地址栏"
                        : "复制本条链接"}
                    </button>
                    {canEdit && persons.length > 0 ? (
                      <button
                        type="button"
                        className="font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                        aria-expanded={attachingId === e.id}
                        onClick={() =>
                          setAttachingId((id) => (id === e.id ? null : e.id))
                        }
                      >
                        {e.linkCount > 0 ? "再挂到人物资料" : "挂到人物资料"}
                      </button>
                    ) : null}
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
                                const label =
                                  e.title?.trim() ||
                                  EVIDENCE_TYPE_UI[e.evidenceType] ||
                                  "资料来源";
                                onRemoved?.(e.id, label);
                                await load();
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
                {attachingId === e.id && canEdit ? (
                  <LibraryAttachForm
                    familyId={familyId}
                    evidenceId={e.id}
                    persons={persons}
                    onAuthError={onAuthError}
                    onOpenRecords={onOpenRecords}
                    onCancel={() => setAttachingId(null)}
                    onDone={async ({ personId: pid, claimId: cid }) => {
                      setAttachingId(null);
                      const qs = new URLSearchParams({
                        tab: "records",
                        person: pid,
                        claim: cid,
                      });
                      setAttachFlash({
                        message:
                          "已挂接到人物资料。可打开查看，或复制链接发给家人。",
                        url: `${window.location.origin}/alpha/families/${familyId}?${qs.toString()}`,
                        personId: pid,
                        claimId: cid,
                      });
                      setAttachCopyFlash("");
                      await load();
                      onLinked?.();
                    }}
                  />
                ) : null}
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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-[color:var(--a-muted)]">
                          暂无可见的关联资料。
                        </p>
                        {canEdit && persons.length > 0 ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                            onClick={() => setAttachingId(e.id)}
                          >
                            {e.linkCount > 0
                              ? "再挂到人物资料"
                              : "挂到人物资料"}
                          </button>
                        ) : null}
                      </div>
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
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[color:var(--a-danger)]">
            <p role="alert" className="min-w-0">
              {error}
            </p>
            <button
              type="button"
              className="shrink-0 font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LibraryAddSourceForm({
  familyId,
  initialEvidenceType = "GENEALOGY_PAGE",
  onAuthError,
  onCancel,
  onDone,
}: {
  familyId: string;
  initialEvidenceType?: string;
  onAuthError: (e: unknown) => boolean;
  onCancel: () => void;
  onDone: (created: { evidenceId: string }) => Promise<void>;
}) {
  const [evidenceType, setEvidenceType] = useState(initialEvidenceType);
  const [title, setTitle] = useState("");
  const [sourceLocator, setSourceLocator] = useState("");
  const [sourceDateText, setSourceDateText] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const leaveWarn = useRef(false);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (leaveWarn.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError("");
    leaveWarn.current = true;
    let phase = "";
    try {
      let mediaObjectId: string | null = null;
      if (file) {
        const mime = mimeFromFile(file);
        if (!mime) {
          setLocalError("不支持的文件类型。请选择图片、PDF、音频或视频。");
          return;
        }
        const max = MEDIA_MAX_BYTES[mime] ?? 0;
        if (file.size > max) {
          const mb = Math.round(max / (1024 * 1024));
          setLocalError(
            mime.startsWith("image/")
              ? `图片最大 ${mb} MB。`
              : mime === "application/pdf"
                ? `PDF 最大 ${mb} MB。`
                : `该类型文件最大 ${mb} MB。`
          );
          return;
        }
        phase = "准备上传";
        setUploadState(phase);
        setUploadPct(12);
        const reserved = await v1api.reserveMedia(
          familyId,
          {
            originalFilename: file.name,
            mimeType: mime,
            byteSize: file.size,
          },
          { idempotencyKey: crypto.randomUUID() }
        );
        phase = "正在上传文件…";
        setUploadState(phase);
        setUploadPct(45);
        const handleUploadUrl = reserved.upload.handleUploadUrl.startsWith(
          "http"
        )
          ? reserved.upload.handleUploadUrl
          : `${window.location.origin}${reserved.upload.handleUploadUrl}`;
        await upload(reserved.upload.pathname, file, {
          access: "private",
          handleUploadUrl,
          clientPayload: JSON.stringify({ mediaId: reserved.media.id }),
          contentType: mime,
          multipart: reserved.upload.multipartRecommended,
        });
        phase = "正在确认文件…";
        setUploadState(phase);
        setUploadPct(72);
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const st = await v1api.mediaStatus(familyId, reserved.media.id);
          if (st.status === "ACTIVE") {
            mediaObjectId = reserved.media.id;
            setUploadState("上传完成");
            setUploadPct(100);
            break;
          }
          if (st.status === "FAILED") {
            throw new Error("upload failed");
          }
          if (st.status === "PENDING_UPLOAD") {
            try {
              await v1api.mediaFinalizeLocal(familyId, reserved.media.id);
            } catch {
              /* keep polling */
            }
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!mediaObjectId) {
          setUploadState("上传超时");
          setLocalError("上传超时，请稍后重试。");
          return;
        }
      }

      if (file) {
        setUploadState("正在保存来源…");
        setUploadPct(92);
      }
      const created = await v1api.createEvidence(
        familyId,
        {
          evidenceType,
          title: title.trim() || null,
          description: description.trim() || null,
          sourceLocator: sourceLocator.trim() || null,
          sourceDateText: sourceDateText.trim() || null,
          mediaObjectId,
        },
        { idempotencyKey: crypto.randomUUID() }
      );
      setUploadState("");
      setUploadPct(0);
      await onDone({ evidenceId: created.evidence.id });
    } catch (err) {
      if (onAuthError(err)) return;
      setUploadState(phase ? "上传失败" : "");
      setLocalError(
        phase
          ? "上传或保存失败，请检查文件后重试。"
          : userMessageForApiError(err)
      );
    } finally {
      leaveWarn.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface-strong)] p-3"
      aria-label="收录资料来源"
    >
      {localError ? (
        <p className="alpha-alert alpha-alert-error" role="alert">
          {localError}
        </p>
      ) : null}
      <div>
        <label htmlFor="lib-ev-type" className="alpha-label">
          来源类型
        </label>
        <select
          id="lib-ev-type"
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value)}
          className="alpha-input"
        >
          {Object.entries(EVIDENCE_TYPE_UI).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="lib-ev-title" className="alpha-label">
          来源标题（可选）
        </label>
        <input
          id="lib-ev-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="alpha-input"
        />
      </div>
      <div>
        <label htmlFor="lib-ev-loc" className="alpha-label">
          出处位置（可选）
        </label>
        <input
          id="lib-ev-loc"
          value={sourceLocator}
          onChange={(e) => setSourceLocator(e.target.value)}
          placeholder="例如：第17页"
          className="alpha-input"
        />
      </div>
      <div>
        <label htmlFor="lib-ev-date" className="alpha-label">
          年代 / 日期（可选）
        </label>
        <input
          id="lib-ev-date"
          value={sourceDateText}
          onChange={(e) => setSourceDateText(e.target.value)}
          placeholder="例如：明嘉靖三十四年"
          className="alpha-input"
        />
      </div>
      <div>
        <label htmlFor="lib-ev-desc" className="alpha-label">
          来源说明（可选）
        </label>
        <textarea
          id="lib-ev-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="alpha-input !min-h-[4.5rem] py-2"
        />
      </div>
      <div>
        <label htmlFor="lib-ev-file" className="alpha-label">
          附件（可选）
        </label>
        <input
          id="lib-ev-file"
          type="file"
          accept={ALLOWED_EXT.join(",")}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setLocalError("");
          }}
          className="block w-full text-sm text-[color:var(--a-muted)]"
        />
        <p className="mt-1 text-xs text-[color:var(--a-muted)]">
          支持 JPG/PNG/WEBP/PDF 与常见音视频。仅家族成员可见。
        </p>
        {file ? (
          <p className="mt-1 text-xs text-[color:var(--a-muted)]">
            已选择：{file.name}
          </p>
        ) : null}
        {uploadState ? (
          <div className="mt-2" role="status" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--a-brand-soft)]">
              <div
                className="h-full bg-[color:var(--a-brand)] transition-[width]"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[color:var(--a-muted)]">
              {uploadState}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="alpha-btn alpha-btn-secondary flex-1 !min-h-[44px]"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={busy}
          className="alpha-btn alpha-btn-primary flex-1 !min-h-[44px]"
        >
          {busy ? "保存中…" : "保存到资料来源库"}
        </button>
      </div>
    </form>
  );
}

function LibraryAttachForm({
  familyId,
  evidenceId,
  persons,
  onAuthError,
  onOpenRecords,
  onCancel,
  onDone,
}: {
  familyId: string;
  evidenceId: string;
  persons: Array<{ id: string; preferredName: string }>;
  onAuthError: (e: unknown) => boolean;
  onOpenRecords?: (
    personId: string,
    opts?: {
      focusClaimId?: string;
      statusFilter?: "PROPOSED" | "CONFLICTED" | "ALL";
      claimType?: string;
    }
  ) => void;
  onCancel: () => void;
  onDone: (result: { personId: string; claimId: string }) => Promise<void>;
}) {
  const sorted = useMemo(
    () =>
      persons
        .slice()
        .sort((a, b) =>
          a.preferredName.localeCompare(b.preferredName, "zh-CN")
        ),
    [persons]
  );
  const [personId, setPersonId] = useState(sorted[0]?.id ?? "");
  const [claims, setClaims] = useState<
    Awaited<ReturnType<typeof v1api.listPersonClaims>>["claims"]
  >([]);
  const [linkedClaimIds, setLinkedClaimIds] = useState<Set<string>>(
    () => new Set()
  );
  const [claimId, setClaimId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    let cancelled = false;
    v1api
      .listEvidenceLinks(familyId, evidenceId)
      .then((r) => {
        if (cancelled) return;
        setLinkedClaimIds(new Set(r.links.map((l) => l.claimId)));
      })
      .catch((e) => {
        if (cancelled || onAuthError(e)) return;
        /* keep empty set — still allow attach */
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, evidenceId, onAuthError]);

  useEffect(() => {
    if (!personId) {
      setClaims([]);
      setClaimId("");
      return;
    }
    let cancelled = false;
    setLoadingClaims(true);
    setLocalError("");
    v1api
      .listPersonClaims(familyId, personId)
      .then((r) => {
        if (cancelled) return;
        const open = r.claims.filter(
          (c) => c.status !== "REJECTED" && !linkedClaimIds.has(c.id)
        );
        setClaims(open);
        setClaimId(open[0]?.id ?? "");
      })
      .catch((e) => {
        if (cancelled || onAuthError(e)) return;
        setLocalError(userMessageForApiError(e));
        setClaims([]);
        setClaimId("");
      })
      .finally(() => {
        if (!cancelled) setLoadingClaims(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, personId, onAuthError, linkedClaimIds]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!claimId) {
      setLocalError("请选择一条人物资料");
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const linkedClaimId = claimId;
      const linkedPersonId = personId;
      await v1api.linkEvidence(
        familyId,
        linkedClaimId,
        { evidenceId, relation: "SUPPORTS" },
        { idempotencyKey: crypto.randomUUID() }
      );
      await onDone({ personId: linkedPersonId, claimId: linkedClaimId });
    } catch (err) {
      if (onAuthError(err)) return;
      setLocalError(userMessageForApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 space-y-3 rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface-strong)] p-3"
      aria-label="挂到人物资料"
    >
      {localError ? (
        <p className="alpha-alert alpha-alert-error" role="alert">
          {localError}
        </p>
      ) : null}
      <div>
        <label htmlFor={`lib-attach-person-${evidenceId}`} className="alpha-label">
          选择家人
        </label>
        <select
          id={`lib-attach-person-${evidenceId}`}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          className="alpha-input"
          required
        >
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.preferredName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`lib-attach-claim-${evidenceId}`} className="alpha-label">
          选择人物资料
        </label>
        {loadingClaims ? (
          <p className="text-sm text-[color:var(--a-muted)]">正在加载…</p>
        ) : claims.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-[color:var(--a-muted)]">
              {linkedClaimIds.size > 0
                ? "这位家人的资料都已挂过这条来源，可换一位家人或先去添加新资料。"
                : "这位家人还没有可挂接的资料。"}
            </p>
            {onOpenRecords && personId ? (
              <button
                type="button"
                className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-sm"
                onClick={() =>
                  onOpenRecords(personId, { claimType: "BIRTH_DATE" })
                }
              >
                去添加人物资料
              </button>
            ) : null}
          </div>
        ) : (
          <select
            id={`lib-attach-claim-${evidenceId}`}
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            className="alpha-input"
            required
          >
            {claims.map((c) => (
              <option key={c.id} value={c.id}>
                {(CLAIM_TYPE_UI[c.claimType]?.label ?? c.claimType) +
                  (c.value?.text ? ` · ${c.value.text}` : "") +
                  (c.status === "CONFLICTED"
                    ? " · 存在不同说法"
                    : c.status === "PROPOSED"
                      ? " · 待确认"
                      : "")}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="alpha-btn alpha-btn-secondary flex-1 !min-h-[44px]"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={busy || !claimId || loadingClaims}
          className="alpha-btn alpha-btn-primary flex-1 !min-h-[44px]"
        >
          {busy ? "挂接中…" : "确认挂接"}
        </button>
      </div>
    </form>
  );
}
