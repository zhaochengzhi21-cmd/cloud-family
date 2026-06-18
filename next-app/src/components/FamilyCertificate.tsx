"use client";

import { useRef, useCallback, useState, useEffect } from "react";

interface FamilyCertificateProps {
  familyName: string;
  familyId: string;
  txHash?: string;
  ipfsCID?: string;
  timestamp?: string;
}

/**
 * 族谱传承证书组件
 *
 * 使用 Canvas API 渲染为完整的整页图片，
 * 支持一键保存为 PNG 下载，移动端可长按保存到相册。
 *
 * 设计风格：古典中国风（米色宣纸背景、深红印章、毛笔字标题）
 */
export default function FamilyCertificate({
  familyName,
  familyId,
  txHash,
  ipfsCID,
  timestamp,
}: FamilyCertificateProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [saving, setSaving] = useState(false);
  const [rendered, setRendered] = useState(false);

  // 当前页面 URL（客户端）
  const pageUrl =
    typeof window !== "undefined"
      ? window.location.href
      : `https://yunzupu.com/family/${familyId}`;

  // 组装展示时间
  const displayTime =
    timestamp ||
    new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    });

  // 短 ID 展示
  const shortFamilyId =
    familyId.length > 20
      ? `${familyId.slice(0, 10)}...${familyId.slice(-8)}`
      : familyId;
  const shortTxHash = txHash
    ? txHash.length > 20
      ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}`
      : txHash
    : "—";

  // Canvas 尺寸（物理像素）
  const CANVAS_W = 700;
  const CANVAS_H = 1000;

  // ======== 渲染证书到 Canvas ========
  const renderCertificate = useCallback(
    async (canvas: HTMLCanvasElement, qrDataUrl: string) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = CANVAS_W;
      const H = CANVAS_H;

      // --- 背景 ---
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, "#f5f0e8");
      bgGrad.addColorStop(1, "#ede2ce");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // --- 宣纸纹理（细点阵）---
      ctx.save();
      ctx.globalAlpha = 0.04;
      for (let x = 0; x < W; x += 20) {
        for (let y = 0; y < H; y += 20) {
          ctx.fillStyle = "#8b0000";
          ctx.beginPath();
          ctx.arc(x, y, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // --- 装饰边框 ---
      const margin = 24;
      ctx.save();
      ctx.strokeStyle = "rgba(139,0,0,0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);
      ctx.restore();

      // 内层虚线边框
      const innerMargin = 16;
      ctx.save();
      ctx.strokeStyle = "rgba(139,0,0,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        innerMargin,
        innerMargin,
        W - innerMargin * 2,
        H - innerMargin * 2
      );
      ctx.restore();

      // --- 顶部印章 ---
      const sealCX = W / 2;
      const sealCY = 100;
      const sealR = 36;
      ctx.save();
      ctx.strokeStyle = "#8b0000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sealCX, sealCY, sealR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(139,0,0,0.03)";
      ctx.fill();
      ctx.restore();

      // 印章文字
      ctx.save();
      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 14px 'Ma Shan Zheng', 'KaiTi', 'STKaiti', 'SimSun', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("永", sealCX, sealCY - 7);
      ctx.fillText("存", sealCX, sealCY + 9);
      ctx.restore();

      // --- 标题 ---
      ctx.save();
      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 26px 'Ma Shan Zheng', 'KaiTi', 'STKaiti', 'SimSun', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("族谱传承证书", W / 2, 170);
      ctx.restore();

      // 标题下分隔线
      ctx.save();
      const lineY = 195;
      const lineW = 60;
      const lineGrad = ctx.createLinearGradient(
        W / 2 - lineW / 2,
        0,
        W / 2 + lineW / 2,
        0
      );
      lineGrad.addColorStop(0, "transparent");
      lineGrad.addColorStop(0.5, "#8b0000");
      lineGrad.addColorStop(1, "transparent");
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W / 2 - lineW / 2, lineY);
      ctx.lineTo(W / 2 + lineW / 2, lineY);
      ctx.stroke();
      ctx.restore();

      // --- 家族名（大号毛笔字）---
      ctx.save();
      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 48px 'Ma Shan Zheng', 'KaiTi', 'STKaiti', 'SimSun', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 阴影
      ctx.shadowColor = "rgba(139,0,0,0.1)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillText(familyName, W / 2, 260);
      ctx.restore();

      // --- 信息行 ---
      const startY = 340;
      const rowH = 36;
      const infoLeft = 160;
      const infoRight = W - 80;

      const infoData: { label: string; value: string }[] = [
        { label: "创建时间", value: displayTime },
        { label: "家族编号", value: shortFamilyId },
      ];
      if (txHash)
        infoData.push({ label: "证书编号", value: shortTxHash });
      if (ipfsCID)
        infoData.push({ label: "存储编号", value: ipfsCID });

      infoData.forEach((item, i) => {
        const y = startY + i * rowH;

        // 标签
        ctx.save();
        ctx.fillStyle = "#8b0000";
        ctx.font = "bold 15px 'Ma Shan Zheng', 'KaiTi', 'STKaiti', 'SimSun', serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, infoLeft, y);
        ctx.restore();

        // 冒号
        ctx.save();
        ctx.fillStyle = "#5c3a2e";
        ctx.font = "15px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("：", infoLeft + 22, y);
        ctx.restore();

        // 值
        ctx.save();
        ctx.fillStyle = "#5c3a2e";
        ctx.font =
          item.label === "创建时间"
            ? "14px serif"
            : "13px 'Courier New', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const val = item.value;
        // 如果值太长，缩小字体
        if (ctx.measureText(val).width > infoRight - infoLeft - 50) {
          ctx.font = "11px 'Courier New', monospace";
        }
        ctx.fillText(val, infoLeft + 36, y);
        ctx.restore();
      });

      // --- 分隔线 ---
      const sepY = startY + infoData.length * rowH + 20;
      ctx.save();
      ctx.strokeStyle = "rgba(139,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(120, sepY);
      ctx.lineTo(W - 120, sepY);
      ctx.stroke();
      ctx.restore();

      // --- QR 码区域 ---
      const qrY = sepY + 30;
      const qrSize = 110;
      const qrX = (W - qrSize) / 2;

      // QR 背景
      ctx.save();
      ctx.fillStyle = "#fdfbf7";
      ctx.shadowColor = "rgba(139,0,0,0.06)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(qrX, qrY, qrSize, qrSize, 6);
      ctx.fill();
      ctx.restore();

      // QR 码边框
      ctx.save();
      ctx.strokeStyle = "rgba(139,0,0,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(qrX, qrY, qrSize, qrSize, 6);
      ctx.stroke();
      ctx.restore();

      // 绘制 QR 码
      if (qrDataUrl) {
        const img = new Image();
        img.src = qrDataUrl;
        await new Promise<void>((resolve) => {
          img.onload = () => {
            ctx.save();
            ctx.drawImage(img, qrX + 5, qrY + 5, qrSize - 10, qrSize - 10);
            ctx.restore();
            resolve();
          };
          // 如果已经加载过，立即绘制
          if (img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.drawImage(img, qrX + 5, qrY + 5, qrSize - 10, qrSize - 10);
            ctx.restore();
            resolve();
          }
        });
      }

      // --- QR 码两侧文字 ---
      // 左侧
      ctx.save();
      ctx.fillStyle = "rgba(92,58,46,0.5)";
      ctx.font = "11px serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("本证书由", qrX - 14, qrY + qrSize / 2 - 10);
      ctx.fillText("云族谱生成", qrX - 14, qrY + qrSize / 2 + 10);
      ctx.restore();

      // 右侧
      ctx.save();
      ctx.fillStyle = "rgba(92,58,46,0.5)";
      ctx.font = "11px serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("数字档案永久保存", qrX + qrSize + 14, qrY + qrSize / 2 - 10);
      ctx.fillText("世代传承", qrX + qrSize + 14, qrY + qrSize / 2 + 10);
      ctx.restore();

      // --- 底部声明 ---
      const footerY = qrY + qrSize + 60;
      ctx.save();
      ctx.fillStyle = "rgba(92,58,46,0.35)";
      ctx.font = "10px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("云族谱 · 家族数据永久保存", W / 2, footerY);
      ctx.restore();

      // --- 底部印章装饰 ---
      ctx.save();
      ctx.fillStyle = "rgba(139,0,0,0.06)";
      ctx.font = "bold 10px 'Ma Shan Zheng', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🔖 永久保存 · 世代流传", W / 2, footerY + 30);
      ctx.restore();

      setRendered(true);
    },
    [familyName, displayTime, shortFamilyId, shortTxHash, txHash, ipfsCID]
  );

  // 生成 QR 码并渲染 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    let cancelled = false;

    (async () => {
      let qrDataUrl = "";
      try {
        const QRCode = (await import("qrcode")).default;
        qrDataUrl = await QRCode.toDataURL(pageUrl, {
          width: 200,
          margin: 1,
          color: {
            dark: "#5c3a2e",
            light: "#fdfbf7",
          },
        });
      } catch (err) {
        console.error("QR 码生成失败:", err);
      }
      if (!cancelled) {
        await renderCertificate(canvas, qrDataUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageUrl, renderCertificate]);

  // ======== 保存为 PNG ========
  const handleSaveImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSaving(true);
    try {
      const dataUrl = canvas.toDataURL("image/png", 1.0);

      // 浏览器原生下载
      const link = document.createElement("a");
      link.download = `${familyName || "族谱证书"}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("证书导出失败:", err);
      // 尝试在新窗口打开
      try {
        const dataUrl = canvas.toDataURL("image/png", 1.0);
        const w = window.open("about:blank", "_blank");
        if (w) {
          w.document.write(
            `<img src="${dataUrl}" style="max-width:100%;height:auto;" alt="族谱证书" />`
          );
        } else {
          alert("保存失败，请使用截图工具（Win+Shift+S）截取证书保存");
        }
      } catch {
        alert("保存失败，请使用截图工具（Win+Shift+S）截取证书保存");
      }
    } finally {
      setSaving(false);
    }
  }, [familyName]);

  // ======== 渲染 ========
  return (
    <div className="flex flex-col items-center gap-6">
      {/* ====== Canvas 渲染的证书（不可见，仅用于导出） ====== */}
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        id="family-certificate"
        className="hidden"
      />

      {/* ====== 预览（用 img 显示 canvas 内容） ====== */}
      {rendered && (
        <div className="w-full max-w-md mx-auto rounded-2xl overflow-hidden shadow-2xl border border-[#d4a76a]/30">
          {canvasRef.current && (
            <img
              src={canvasRef.current.toDataURL("image/png", 1.0)}
              alt="族谱证书预览"
              className="w-full h-auto block"
              id="family-certificate-preview"
            />
          )}
        </div>
      )}

      {!rendered && (
        <div
          className="w-full max-w-md mx-auto rounded-2xl border border-[#d4a76a]/30 flex items-center justify-center"
          style={{ height: "400px", background: "#f5f0e8" }}
        >
          <div className="text-center">
            <div className="w-10 h-10 mx-auto rounded-full border-4 border-[#8b0000]/20 border-t-[#8b0000] animate-spin" />
            <p className="mt-4 text-sm text-[#c4a67a]">证书生成中...</p>
          </div>
        </div>
      )}

      {/* ====== 操作按钮 ====== */}
      <div className="flex gap-4">
        <button
          onClick={handleSaveImage}
          disabled={saving || !rendered}
          className="px-10 py-4 rounded-2xl text-base font-bold tracking-wider transition-all duration-200 active:scale-95 disabled:opacity-60 shadow-xl flex items-center gap-2"
          style={{
            background: "linear-gradient(135deg, #8b0000, #a52a2a)",
            color: "#fff",
            boxShadow: "0 4px 20px rgba(139,0,0,0.3)",
          }}
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              生成中…
            </>
          ) : (
            <>
              <span className="text-xl">💾</span>
              保存证书
            </>
          )}
        </button>
      </div>

      {/* 移动端提示 */}
      <p className="text-xs text-[#c4a67a] text-center">
        点击上方按钮下载 PNG 图片，移动端长按预览图可保存到相册
      </p>
    </div>
  );
}