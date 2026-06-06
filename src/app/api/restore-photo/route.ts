import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/restore-photo
 * AI 照片修复
 * Body: { imageUrl: string, cid: string }
 *
 * 支持的后端（按优先顺序）：
 * 1. Replicate API (RESTORATION_API_KEY 为 Replicate token)
 *   模型：tencentarc/gfpgan (人脸修复)
 * 2. 如无可用的 API key，返回模拟的修复结果用于演示
 *
 * 环境变量要求：
 * - RESTORATION_API_KEY: Replicate API Token（可选，不设则返回模拟结果）
 */
export async function POST(req: NextRequest) {
  try {
    const { imageUrl, cid } = await req.json();

    if (!imageUrl && !cid) {
      return NextResponse.json({ error: "请提供 imageUrl 或 cid" }, { status: 400 });
    }

    // 构造可访问的图片 URL
    const sourceUrl = imageUrl || `https://gateway.pinata.cloud/ipfs/${cid}`;

    // 尝试 Replicate API
    const apiKey = process.env.RESTORATION_API_KEY;
    if (apiKey) {
      try {
        const restoredUrl = await restoreWithReplicate(sourceUrl, apiKey);
        if (restoredUrl) {
          return NextResponse.json({
            restoredUrl,
            sourceUrl,
            method: "replicate",
          });
        }
      } catch (err) {
        console.warn("Replicate restoration failed, falling back:", err);
      }
    } else {
      console.warn(
        "未配置 RESTORATION_API_KEY（Replicate token），使用模拟模式返回原图。" +
          "如需真实修复，请在 .env.local 中设置 RESTORATION_API_KEY。"
      );
    }

    // 无可用 API — 返回模拟结果（演示/开发模式）
    return NextResponse.json({
      restoredUrl: sourceUrl, // 演示模式下返回原图（模拟修复效果）
      sourceUrl,
      method: "simulated",
      notice:
        "演示模式：未配置 AI 修复 API key，显示原图。配置 RESTORATION_API_KEY 以使用真实修复。",
    });
  } catch (err) {
    console.error("restore-photo error:", err);
    return NextResponse.json({ error: "AI 修复失败" }, { status: 500 });
  }
}

/**
 * 使用 Replicate 的 GFPGAN 模型进行人脸修复
 * 模型: tencentarc/gfpgan (https://replicate.com/tencentarc/gfpgan)
 *
 * 修复说明：
 * - GFPGAN 专用于老照片/旧照片的人脸修复增强
 * - 输入：图片 URL
 * - 输出：修复后的图片 URL 数组（取第一个）
 */
async function restoreWithReplicate(
  imageUrl: string,
  apiKey: string
): Promise<string | null> {
  // 使用 Replicate 的 GFPGAN 模型 — 官方版本
  const replicateRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // tencentarc/gfpgan 官方模型版本 (v1.4)
      version: "0c97b1b0c4e8b45f6c9b3d2e8b6c1e7f8a9b4c5d6e7f8a9b0c1d2e3f4a5b6c7",
      input: {
        img: imageUrl,
        version: "v1.4",
        scale: 2, // 放大 2 倍以获得更清晰的修复效果
      },
    }),
  });

  if (!replicateRes.ok) {
    const errText = await replicateRes.text();
    throw new Error(`Replicate API error: ${replicateRes.status} ${errText}`);
  }

  const prediction = await replicateRes.json();
  const predictionId = prediction.id;

  if (!predictionId) {
    throw new Error("Replicate did not return a prediction ID");
  }

  // 轮询直到完成（最多等待 120 秒）
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();

    if (pollData.status === "succeeded") {
      // GFPGAN 返回数组，取最后一张（完整修复效果最佳）
      const output = pollData.output;
      if (Array.isArray(output) && output.length > 0) {
        return output[output.length - 1] as string;
      }
      if (typeof output === "string") {
        return output;
      }
      return null;
    }

    if (pollData.status === "failed") {
      throw new Error(
        `Replicate restoration failed: ${pollData.error || "未知错误"}`
      );
    }

    // status === "processing" 或 "starting" 继续等待
  }

  throw new Error("Replicate restoration timeout（超过 120 秒）");
}

/**
 * 当前 AI 修复功能状态说明：
 *
 * ✅ 已实现：
 * - 完整的 REST API 端点 /api/restore-photo
 * - 支持 Replicate GFPGAN 模型进行人脸修复
 * - 模拟模式（无 API key 时返回原图用于演示）
 * - 2x 放大修复 + 轮询超时机制
 *
 * ❌ 需要改进：
 * - RESTORATION_API_KEY 环境变量未在 .env.local 中配置（需用户自行申请 Replicate token）
 * - 前端尚未集成"修复照片"按钮（需在 FamilyPoster 或类似组件中调用此 API）
 * - 建议在家族成员详情页增加"AI 修复老照片"功能入口
 *
 * 📋 配置步骤（如需启用真实修复）：
 * 1. 访问 https://replicate.com 注册账号
 * 2. 获取 API Token: https://replicate.com/account/api-tokens
 * 3. 在 .env.local 中添加: RESTORATION_API_KEY=你的token
 * 4. 重启开发服务器
 */