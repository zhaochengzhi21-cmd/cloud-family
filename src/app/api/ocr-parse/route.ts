import { NextRequest, NextResponse } from "next/server";

/**
 * 获取百度 OCR access_token
 */
async function getBaiduAccessToken(): Promise<string> {
  const apiKey = process.env.BAIDU_OCR_API_KEY;
  const secret = process.env.BAIDU_OCR_SECRET;

  if (!apiKey || !secret) {
    throw new Error("缺少 BAIDU_OCR_API_KEY 或 BAIDU_OCR_SECRET 环境变量");
  }

  const res = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secret}`,
    { method: "POST" }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("百度 OCR token 获取失败:", errText);
    throw new Error("百度 OCR token 获取失败");
  }

  const data = await res.json();
  return data.access_token as string;
}

/**
 * 用百度 OCR 识别图片文字（高精度版）
 */
async function ocrImage(imageUrl: string): Promise<string> {
  const token = await getBaiduAccessToken();

  // 下载图片，转为 base64
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error(`图片下载失败: ${imageRes.statusText}`);
  }
  const imageBuffer = await imageRes.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString("base64");

  // 调用百度 OCR 高精度接口
  const ocrRes = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ image: base64Image }),
    }
  );

  if (!ocrRes.ok) {
    const errText = await ocrRes.text();
    console.error("百度 OCR 调用失败:", errText);
    throw new Error(`OCR 识别失败: ${ocrRes.statusText}`);
  }

  const data = await ocrRes.json();
  if (data.error_code) {
    throw new Error(`百度 OCR 错误: ${data.error_msg || data.error_code}`);
  }

  const words = data.words_result || [];
  if (words.length === 0) {
    throw new Error("OCR 未能识别出任何文字，请确认图片中是否包含清晰的文字");
  }

  return words.map((w: any) => w.words).join("\n");
}

/**
 * 用 DeepSeek API 解析 OCR 原始文字 → 结构化成员数组
 */
async function parseTextViaDeepSeek(text: string): Promise<any[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY 环境变量");
  }

  const systemPrompt = `你是一位精通中国族谱研究的专家。请从用户提供的老族谱 OCR 文字中，解析出每位家族成员的信息。

请返回严格 JSON 数组格式，每个元素包含以下字段：
- name: 姓名（必填）
- relation: 与始祖的关系描述，如"长子"、"次女"、"孙"等
- birth: 出生年份（如光绪十二年可转换为1886，如仅有年号则保留原文）
- death: 逝世年份（如有）
- gender: "男"或"女"

注意：
1. 只输出 JSON 数组，不要任何解释或标记
2. 如果文字完全无法识别为族谱内容，返回空数组 []
3. 年份尽可能转换为公元纪年数字
4. 名称去除空格和特殊字符`;

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    console.error("DeepSeek API 调用失败:", res.status, errText);
    throw new Error(`DeepSeek API 错误: ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";

  if (!content) {
    throw new Error("DeepSeek 未返回有效内容");
  }

  // 尝试从 markdown 代码块中提取 JSON
  let jsonStr = content;
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error("DeepSeek 返回格式异常，期望数组");
  }

  return parsed;
}

/**
 * POST /api/ocr-parse
 * 接收老族谱图片 IPFS 链接，识别并解析为结构化家族成员数据
 * Body: { imageUrl: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "缺少 imageUrl 参数" }, { status: 400 });
    }

    // 1. OCR 识别图片文字
    const ocrText = await ocrImage(imageUrl);

    if (!ocrText.trim()) {
      return NextResponse.json(
        { error: "图片中未识别出文字，请确认图片清晰度" },
        { status: 400 }
      );
    }

    // 2. DeepSeek 解析结构化数据
    const members = await parseTextViaDeepSeek(ocrText);

    if (members.length === 0) {
      return NextResponse.json({
        members: [],
        ocrText,
        message: "未能从识别的文字中解析出家谱成员信息",
      });
    }

    return NextResponse.json({
      members,
      ocrText,
      total: members.length,
    });
  } catch (err: any) {
    console.error("ocr-parse error:", err);
    const message = err.message || "OCR 解析失败";
    // 区分用户友好错误和系统错误
    if (
      message.includes("API 错误") ||
      message.includes("百度 OCR") ||
      message.includes("缺少") ||
      message.includes("未能识别")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "老谱识别失败，请稍后重试" }, { status: 500 });
  }
}