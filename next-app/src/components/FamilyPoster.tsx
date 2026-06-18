import { useCallback, useRef, useState } from "react";

interface FamilyPosterProps {
  familyName: string;
  totalGenerations: number;
  totalMembers: number;
  founderName: string;
  description?: string;
  familyUrl: string;
  onClose: () => void;
}

// 生成二维码数据 URL（使用 QRServer API）
function getQrCodeUrl(text: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}`;
}

export default function FamilyPoster({
  familyName,
  totalGenerations,
  totalMembers,
  founderName,
  description,
  familyUrl,
  onClose,
}: FamilyPosterProps) {
  const posterRef = useRef<HTMLDivElement>(null);
  const [qrLoaded, setQrLoaded] = useState(false);

  // ---------- 下载海报 ----------
  const handleDownload = useCallback(async () => {
    const el = posterRef.current;
    if (!el) return;

    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        quality: 0.95,
        pixelRatio: 3,
        backgroundColor: "#f5f0e8",
      });
      const link = document.createElement("a");
      link.download = `${familyName}-家族海报.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // fallback: 截图提示
      alert("请使用系统截图工具（Win+Shift+S 或 Cmd+Shift+4）截取海报保存");
    }
  }, [familyName]);

  const tagline = description?.trim() || "家族记忆，永久保存";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative max-w-lg mx-4">
        {/* 操作栏 */}
        <div className="flex justify-end gap-2 mb-2">
          <button
            onClick={handleDownload}
            disabled={!qrLoaded}
            className="px-4 py-2 rounded-xl text-sm font-bold tracking-wider bg-gradient-to-r from-[#8b0000] to-[#a52a2a] text-white hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            💾 下载海报
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold tracking-wider bg-white border-2 border-[#d4a76a]/50 text-[#5c3a2e] hover:bg-[#f5f0e8] transition-all duration-200"
          >
            ✕ 关闭
          </button>
        </div>

        {/* 海报本体 — 古典中国风 */}
        <div
          ref={posterRef}
          className="relative w-[400px] overflow-hidden rounded-2xl shadow-2xl"
          style={{
            backgroundColor: "#f5f0e8",
            backgroundImage: `
              linear-gradient(rgba(139, 0, 0, 0.04) 1px, transparent 1px),
              linear-gradient(90deg, rgba(139, 0, 0, 0.04) 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
          }}
        >
          {/* 顶部装饰条 */}
          <div className="h-2 bg-gradient-to-r from-[#8b0000] via-[#a52a2a] to-[#8b0000]" />

          {/* 内容区 */}
          <div className="px-10 py-10 text-center">
            {/* 云纹装饰 */}
            <div className="text-4xl mb-4 opacity-30" style={{ fontFamily: "serif" }}>
              〰️
            </div>

            {/* 标题 — 毛笔字风格 */}
            <h1
              className="text-4xl font-black tracking-[0.3em] mb-2"
              style={{
                color: "#8b0000",
                fontFamily: "'STKaiti', 'KaiTi', 'SimSun', 'Noto Serif SC', serif",
                textShadow: "1px 1px 2px rgba(139,0,0,0.2)",
              }}
            >
              {familyName}
            </h1>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#d4a76a] to-transparent" />
            </div>

            {/* 家族信息 */}
            <div className="space-y-3 mb-6">
              <div className="flex justify-center gap-8">
                <div className="text-center">
                  <div
                    className="text-3xl font-black"
                    style={{ color: "#8b0000" }}
                  >
                    {totalGenerations}
                  </div>
                  <div className="text-sm text-[#5c3a2e]/70 tracking-wider mt-1">
                    代传承
                  </div>
                </div>
                <div className="w-px bg-[#d4a76a]/40" />
                <div className="text-center">
                  <div
                    className="text-3xl font-black"
                    style={{ color: "#8b0000" }}
                  >
                    {totalMembers}
                  </div>
                  <div className="text-sm text-[#5c3a2e]/70 tracking-wider mt-1">
                    位族人
                  </div>
                </div>
              </div>
            </div>

            {/* 已知最早先辈 */}
            {founderName && (
              <div className="mb-5">
                <div className="text-sm text-[#5c3a2e]/60 tracking-wider mb-1">
                  已知最早先辈
                </div>
                <div
                  className="text-2xl font-bold tracking-wider"
                  style={{ color: "#5c3a2e" }}
                >
                  {founderName}
                </div>
              </div>
            )}

            {/* 自定义简介 */}
            <div
              className="mb-6 px-4 py-3 rounded-xl"
              style={{
                backgroundColor: "rgba(212, 167, 106, 0.15)",
                border: "1px solid rgba(212, 167, 106, 0.3)",
              }}
            >
              <p
                className="text-sm leading-relaxed tracking-wider"
                style={{ color: "#5c3a2e" }}
              >
                {tagline}
              </p>
            </div>

            {/* 二维码 */}
            <div className="flex justify-center mb-4">
              <div
                className="p-3 rounded-xl bg-white"
                style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
              >
                <img
                  src={getQrCodeUrl(familyUrl)}
                  alt="二维码"
                  width={120}
                  height={120}
                  className="block"
                  onLoad={() => setQrLoaded(true)}
                  onError={() => setQrLoaded(true)} // 即使加载失败也不阻塞
                />
              </div>
            </div>
            <div className="text-xs text-[#c4a67a] tracking-wider">
              扫码查看完整族谱
            </div>

            {/* 底部装饰 */}
            <div className="mt-6 pt-4 border-t border-[#d4a76a]/20">
              <p
                className="text-xs tracking-wider"
                style={{ color: "#c4a67a" }}
              >
                云族谱 · 家族数字记忆永存
              </p>
            </div>
          </div>

          {/* 底部装饰条 */}
          <div className="h-2 bg-gradient-to-r from-[#8b0000] via-[#a52a2a] to-[#8b0000]" />
        </div>
      </div>
    </div>
  );
}