import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { name, birth, death, relatives } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "缺少姓名" }, { status: 400 });
    }

    // 构建提示词
    const lifeSpan = [birth, death].filter(Boolean).join(" — ");
    const relativeStr = relatives?.length
      ? `其亲属有：${relatives.join("、")}。`
      : "";

    const prompt = `你是一位精通中国古典文风的传记作家。请根据以下信息，用精简古雅的语言为「${name}」撰写一篇80-150字的人物小传。

已知信息：
- 姓名：${name}
${lifeSpan ? `- 生卒：${lifeSpan}` : ""}
${relativeStr ? `- ${relativeStr}` : ""}

要求：
1. 用文言白话相间的风格，以「${name}」开头
2. 涵盖其生平大要，突出传统家族价值观
3. 语气庄重典雅，体现中华传统文化韵味
4. 仅输出小传正文，不要标题和注释
5. 篇幅控制在80-150字`;

    // 调用 AI API
    const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      // 无 API key 时返回模拟数据
      const simulated = `${name}，${birth || "生年不详"}${death ? `至${death}` : ""}。自幼聪颖，秉性纯良，勤勉持家，睦邻亲友。一生恪守祖训，敦亲睦族，为后世子孙所敬仰。其德行风范，足为家族楷模。`;
      return NextResponse.json({ biography: simulated, method: "simulated" });
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "你是一位精通中国古典文风的传记作家，输出文言白话相间的精炼人物小传。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("AI API 调用失败:", res.status, errText);
      throw new Error(`AI API error: ${res.status}`);
    }

    const data = await res.json();
    const biography = data.choices?.[0]?.message?.content?.trim() || "";

    if (!biography) {
      throw new Error("AI 未返回有效内容");
    }

    return NextResponse.json({ biography, method: "ai" });
  } catch (err) {
    console.error("生成小传失败:", err);
    return NextResponse.json(
      { error: "AI 小传生成失败，请稍后重试", biography: "" },
      { status: 500 }
    );
  }
}