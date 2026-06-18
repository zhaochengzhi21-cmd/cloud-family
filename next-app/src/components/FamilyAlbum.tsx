"use client";

import { useState, useCallback, useRef } from "react";
import { getImageUrls, createImgFallback } from "@/lib/ipfsGateway";
import type { AlbumPhoto, FamilyTree } from "@/types/family";

// ==================== 单张照片上传信息 ====================
interface UploadItem {
  file: File;
  caption: string;
  time: string;
  location: string;
  people: string;
  progress: "pending" | "uploading" | "done" | "error";
  cid?: string;
  errorMsg?: string;
}

// ==================== 照片查看器（含 AI 修复对比） ====================
function PhotoViewer({
  photos,
  initialIndex,
  onClose,
  onRestore,
  restoringIndex,
  restoredMap,
}: {
  photos: AlbumPhoto[];
  initialIndex: number;
  onClose: () => void;
  onRestore: (index: number, cid: string) => void;
  restoringIndex: number | null;
  restoredMap: Record<string, string>;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [showOriginal, setShowOriginal] = useState(false);
  const photo = photos[index];
  if (!photo) return null;

  const canPrev = index > 0;
  const canNext = index < photos.length - 1;
  const restoredUrl = restoredMap[photo.cid];
  const isRestoring = restoringIndex === index;
  const photoUrls = getImageUrls(photo.cid);
  const displayUrl = showOriginal || !restoredUrl
    ? photoUrls[0]
    : restoredUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full mx-4 bg-white/95 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#fdfbf7] border-b border-[#d4a76a]/20">
          <span className="text-sm font-bold text-[#5c3a2e]">
            {index + 1} / {photos.length}
          </span>
          <div className="flex items-center gap-2">
            {restoredUrl && (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className={`text-xs font-bold px-3 py-1 rounded-lg transition-all ${
                  showOriginal
                    ? "bg-amber-100 text-amber-700 border border-amber-300"
                    : "bg-green-100 text-green-700 border border-green-300"
                }`}
              >
                {showOriginal ? "查看修复版" : "查看原图"}
              </button>
            )}
            {!restoredUrl && !isRestoring && (
              <button
                onClick={() => onRestore(index, photo.cid)}
                className="text-xs font-bold px-3 py-1 rounded-lg bg-[#fdfbf7] text-[#8b0000] border border-[#d4a76a]/40 hover:bg-[#8b0000]/5 hover:border-[#8b0000]/30 transition-all"
              >
                ✨ AI 修复
              </button>
            )}
            {isRestoring && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#8b0000] bg-[#fdfbf7] px-3 py-1 rounded-lg border border-[#d4a76a]/40">
                <div className="w-3 h-3 border-2 border-[#8b0000]/30 border-t-[#8b0000] rounded-full animate-spin" />
                修复中...
              </div>
            )}
            <button
              onClick={onClose}
              className="text-[#c4a67a] hover:text-[#8b0000] transition-colors text-xl leading-none ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 图片区域 */}
        <div className="relative flex items-center justify-center bg-black/5 min-h-[300px] max-h-[70vh]">
          <img
            src={displayUrl}
            alt={photo.caption || "家族照片"}
            className="max-w-full max-h-[70vh] object-contain"
            onError={createImgFallback(photoUrls)}
          />

          {isRestoring && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <div className="bg-white/90 rounded-xl px-5 py-3 shadow-lg text-center">
                <div className="w-6 h-6 border-2 border-[#8b0000] border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                <span className="text-xs font-bold text-[#8b0000]">AI 修复中...</span>
              </div>
            </div>
          )}

          {/* 左右导航箭头 */}
          {canPrev && (
            <button
              onClick={() => setIndex(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 shadow-lg flex items-center justify-center text-[#5c3a2e] hover:bg-white hover:text-[#8b0000] transition-all text-lg"
            >
              ‹
            </button>
          )}
          {canNext && (
            <button
              onClick={() => setIndex(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 shadow-lg flex items-center justify-center text-[#5c3a2e] hover:bg-white hover:text-[#8b0000] transition-all text-lg"
            >
              ›
            </button>
          )}
        </div>

        {/* 底部说明 */}
        <div className="px-4 py-3 bg-[#fdfbf7] border-t border-[#d4a76a]/20 space-y-1">
          {photo.caption && (
            <p className="text-sm font-bold text-[#5c3a2e]">{photo.caption}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#c4a67a]">
            {photo.time && <span>📅 {photo.time}</span>}
            {photo.location && <span>📍 {photo.location}</span>}
            {photo.people && <span>👥 {photo.people}</span>}
          </div>
          {restoredUrl && (
            <p className="text-[10px] text-green-600 mt-1">
              ✅ AI 修复完成
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== 主组件 ====================
export function FamilyAlbum({
  tree,
  editable,
  onTreeChange,
}: {
  tree: FamilyTree;
  editable?: boolean;
  onTreeChange?: (newTree: FamilyTree) => void;
}) {
  const photos: AlbumPhoto[] = tree.album || [];
  const [showUploader, setShowUploader] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI 修复状态
  const [restoringIndex, setRestoringIndex] = useState<number | null>(null);
  const [restoredMap, setRestoredMap] = useState<Record<string, string>>({});
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ---------- 选择文件 ----------
  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // 最多 9 张
    const toAdd = files.slice(0, 9);
    const items: UploadItem[] = toAdd.map((f) => ({
      file: f,
      caption: "",
      time: "",
      location: "",
      people: "",
      progress: "pending" as const,
    }));
    setUploadItems((prev) => [...prev, ...items]);
    setShowUploader(true);
    // 清空 input 以便重复选同文件
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ---------- 更新某条目的字段 ----------
  const updateItem = useCallback((idx: number, partial: Partial<UploadItem>) => {
    setUploadItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...partial };
      return next;
    });
  }, []);

  // ---------- 删除待上传条目 ----------
  const removeItem = useCallback((idx: number) => {
    setUploadItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ---------- 上传全部 ----------
  const handleUpload = useCallback(async () => {
    const pending = uploadItems.filter((item) => item.progress === "pending");
    if (pending.length === 0) return;

    setUploading(true);

    const results: AlbumPhoto[] = [];

    for (let i = 0; i < uploadItems.length; i++) {
      const item = uploadItems[i];
      if (item.progress !== "pending") continue;

      updateItem(i, { progress: "uploading" });

      try {
        // 单张上传到 IPFS
        const formData = new FormData();
        formData.append("file", item.file);

        const res = await fetch("/api/upload-photo", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!data.success || !data.cid) {
          throw new Error(data.error || "上传失败");
        }

        updateItem(i, { progress: "done", cid: data.cid });

        results.push({
          cid: data.cid,
          caption: item.caption || "",
          time: item.time || "",
          location: item.location || "",
          people: item.people || "",
          uploadedAt: new Date().toISOString(),
        });
      } catch (err) {
        updateItem(i, {
          progress: "error",
          errorMsg: err instanceof Error ? err.message : "上传异常",
        });
      }
    }

    if (results.length > 0) {
      // 合并到已有相册
      const updated: FamilyTree = {
        ...tree,
        album: [...(tree.album || []), ...results],
        updatedAt: new Date().toISOString(),
      };
      onTreeChange?.(updated);
      // 清空待上传列表
      setUploadItems([]);
      setShowUploader(false);
    }

    setUploading(false);
  }, [uploadItems, tree, onTreeChange, updateItem]);

  // ---------- 删除照片 ----------
  const handleDeletePhoto = useCallback(
    (cidToDelete: string) => {
      if (!window.confirm("确定要删除这张照片吗？此操作不可撤销。")) return;
      const updated: FamilyTree = {
        ...tree,
        album: (tree.album || []).filter((p) => p.cid !== cidToDelete),
        updatedAt: new Date().toISOString(),
      };
      onTreeChange?.(updated);
    },
    [tree, onTreeChange]
  );

  // ---------- AI 修复单张照片 ----------
  const handleRestore = useCallback(async (index: number, cid: string) => {
    setRestoringIndex(index);
    setRestoreError(null);
    try {
      const res = await fetch("/api/restore-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid }),
      });
      const data = await res.json();
      if (data.restoredUrl) {
        setRestoredMap((prev) => ({ ...prev, [cid]: data.restoredUrl }));
      } else {
        setRestoreError(data.error || "修复失败");
        // 3 秒后自动清除错误提示
        setTimeout(() => setRestoreError(null), 3000);
      }
    } catch (err) {
      setRestoreError("修复服务暂不可用");
      setTimeout(() => setRestoreError(null), 3000);
    } finally {
      setRestoringIndex(null);
    }
  }, []);

  // 按上传时间倒序
  const sortedPhotos = [...photos].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  return (
    <div className="bg-white/90 rounded-2xl shadow-lg border border-[#d4a76a]/30 p-6 md:p-8">
      {/* 标题 */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">📷</span>
          <h2 className="text-xl md:text-2xl font-black text-[#8b0000] tracking-wider">
            家族相册
          </h2>
        </div>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#8b0000] to-transparent mx-auto mt-2 mb-2" />
        <p className="text-[#5c3a2e] text-sm">
          共 {photos.length} 张照片
        </p>
      </div>

      {/* 上传按钮（编辑模式） */}
      {editable && (
        <div className="text-center mb-6">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3 bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white rounded-xl font-bold text-base hover:from-[#a52a2a] hover:to-[#8b0000] transition-all shadow-lg shadow-[#8b0000]/30 hover:shadow-xl hover:shadow-[#8b0000]/40 hover:scale-105 active:scale-95"
          >
            📤 上传照片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <p className="text-xs text-[#c4a67a] mt-2">支持 JPG / PNG / WEBP，最多可选 9 张</p>
        </div>
      )}

      {/* 上传面板 */}
      {showUploader && uploadItems.length > 0 && (
        <div className="mb-8 p-4 bg-[#fdfbf7] rounded-xl border border-[#d4a76a]/30">
          <h3 className="text-sm font-bold text-[#5c3a2e] mb-3">
            待上传 {uploadItems.filter((i) => i.progress === "pending").length} 张
          </h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {uploadItems.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 bg-white rounded-lg border border-[#d4a76a]/20"
              >
                {/* 缩略图 */}
                <img
                  src={URL.createObjectURL(item.file)}
                  alt="预览"
                  className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                />
                {/* 信息输入 */}
                <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 text-xs">
                  <input
                    type="text"
                    placeholder="说明（可选）"
                    value={item.caption}
                    onChange={(e) => updateItem(idx, { caption: e.target.value })}
                    disabled={item.progress === "uploading"}
                    className="col-span-2 px-2 py-1.5 border border-[#d4a76a]/30 rounded-lg text-[#5c3a2e] bg-[#fdfbf7] focus:outline-none focus:border-[#8b0000]"
                  />
                  <input
                    type="text"
                    placeholder="时间（可选）"
                    value={item.time}
                    onChange={(e) => updateItem(idx, { time: e.target.value })}
                    disabled={item.progress === "uploading"}
                    className="px-2 py-1.5 border border-[#d4a76a]/30 rounded-lg text-[#5c3a2e] bg-[#fdfbf7] focus:outline-none focus:border-[#8b0000]"
                  />
                  <input
                    type="text"
                    placeholder="地点（可选）"
                    value={item.location}
                    onChange={(e) => updateItem(idx, { location: e.target.value })}
                    disabled={item.progress === "uploading"}
                    className="px-2 py-1.5 border border-[#d4a76a]/30 rounded-lg text-[#5c3a2e] bg-[#fdfbf7] focus:outline-none focus:border-[#8b0000]"
                  />
                  <input
                    type="text"
                    placeholder="人物（可选）"
                    value={item.people}
                    onChange={(e) => updateItem(idx, { people: e.target.value })}
                    disabled={item.progress === "uploading"}
                    className="px-2 py-1.5 border border-[#d4a76a]/30 rounded-lg text-[#5c3a2e] bg-[#fdfbf7] focus:outline-none focus:border-[#8b0000]"
                  />
                  {/* 状态指示 */}
                  <div className="flex items-center gap-2">
                    {item.progress === "uploading" && (
                      <div className="w-3 h-3 border-2 border-[#8b0000]/30 border-t-[#8b0000] rounded-full animate-spin" />
                    )}
                    {item.progress === "done" && (
                      <span className="text-green-600">✓</span>
                    )}
                    {item.progress === "error" && (
                      <span className="text-red-500 text-[10px]">{item.errorMsg || "失败"}</span>
                    )}
                  </div>
                </div>
                {/* 删除待上传 */}
                {item.progress === "pending" && (
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-[#c4a67a] hover:text-red-500 transition-colors text-sm flex-shrink-0"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleUpload}
              disabled={uploading || uploadItems.every((i) => i.progress === "done")}
              className="flex-1 px-4 py-2.5 bg-[#8b0000] text-white rounded-xl font-bold text-sm hover:bg-[#a52a2a] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  上传中...
                </>
              ) : (
                `上传 ${uploadItems.filter((i) => i.progress === "pending").length} 张`
              )}
            </button>
            <button
              onClick={() => { setShowUploader(false); setUploadItems([]); }}
              disabled={uploading}
              className="px-4 py-2.5 bg-[#f5f0e8] text-[#5c3a2e] rounded-xl font-bold text-sm hover:bg-[#e8dcc8] transition-colors disabled:opacity-40"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 全局修复错误提示 */}
      {restoreError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 text-center">
          {restoreError}
        </div>
      )}

      {/* 照片网格 */}
      {sortedPhotos.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🖼️</div>
          <p className="text-[#5c3a2e] text-sm">
            暂无照片
          </p>
          {editable && (
            <p className="text-[#c4a67a] text-xs mt-1">
              点击上方「上传照片」按钮，记录家族美好瞬间
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedPhotos.map((photo, idx) => {
            const photoUrls = getImageUrls(photo.cid);
            const originalUrl = photoUrls[0];
            const displayUrl = restoredMap[photo.cid] || originalUrl;
            const isRestoring = restoringIndex === idx;

            return (
              <div
                key={photo.cid}
                className="group bg-white rounded-xl border border-[#d4a76a]/20 overflow-hidden hover:shadow-lg hover:border-[#d4a76a]/40 transition-all duration-200"
              >
                {/* 缩略图 */}
                <div
                  className="relative aspect-[4/3] bg-[#fdfbf7] cursor-pointer overflow-hidden"
                  onClick={() => setViewerIndex(idx)}
                >
                  <img
                    src={displayUrl}
                    alt={photo.caption || "家族照片"}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={createImgFallback(photoUrls)}
                  />
                  {/* 已修复标记 */}
                  {restoredMap[photo.cid] && (
                    <div className="absolute top-2 left-2 bg-green-500/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      AI 修复
                    </div>
                  )}
                  {/* 修复中遮罩 */}
                  {isRestoring && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="bg-white/90 rounded-xl px-4 py-2 shadow-lg">
                        <div className="w-5 h-5 border-2 border-[#8b0000] border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                        <span className="text-xs font-bold text-[#8b0000]">AI 修复中...</span>
                      </div>
                    </div>
                  )}
                  {/* 删除按钮（编辑模式） */}
                  {editable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePhoto(photo.cid);
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-red-500 transition-all text-xs"
                      title="删除照片"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* 说明文字 */}
                <div className="px-3 py-2.5 space-y-1">
                  {photo.caption && (
                    <p className="text-sm font-bold text-[#5c3a2e] truncate">{photo.caption}</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#c4a67a]">
                    {photo.time && <span>📅 {photo.time}</span>}
                    {photo.location && <span>📍 {photo.location}</span>}
                    {photo.people && <span>👥 {photo.people}</span>}
                  </div>
                  {/* AI 修复按钮 */}
                  <div className="flex gap-2 pt-1">
                    {restoredMap[photo.cid] ? (
                      <button
                        onClick={() => setViewerIndex(idx)}
                        className="flex-1 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-all"
                      >
                        ✅ 查看修复效果
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(idx, photo.cid);
                        }}
                        disabled={restoringIndex !== null}
                        className="flex-1 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#fdfbf7] text-[#8b0000] border border-[#d4a76a]/40 hover:bg-[#8b0000]/5 hover:border-[#8b0000]/30 transition-all disabled:opacity-40"
                      >
                        {isRestoring ? (
                          <span className="flex items-center justify-center gap-1">
                            <div className="w-3 h-3 border-2 border-[#8b0000]/30 border-t-[#8b0000] rounded-full animate-spin" />
                            修复中...
                          </span>
                        ) : (
                          "✨ AI 修复"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 照片查看器 */}
      {viewerIndex !== null && (
        <PhotoViewer
          photos={sortedPhotos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onRestore={handleRestore}
          restoringIndex={restoringIndex}
          restoredMap={restoredMap}
        />
      )}
    </div>
  );
}