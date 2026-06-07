import { NextRequest, NextResponse } from "next/server";

// 意见反馈存储（内存存储，生产环境应使用数据库）
interface FeedbackItem {
  id: string;
  email: string;
  content: string;
  contact?: string;
  createdAt: string;
}

const feedbacks: FeedbackItem[] = [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, contact } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "请填写反馈内容" },
        { status: 400 }
      );
    }

    if (content.length > 1000) {
      return NextResponse.json(
        { success: false, error: "反馈内容不能超过1000字" },
        { status: 400 }
      );
    }

    const feedback: FeedbackItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      email: body.email || "匿名",
      content: content.trim(),
      contact: contact || undefined,
      createdAt: new Date().toISOString(),
    };

    feedbacks.unshift(feedback);

    // 限制存储数量
    if (feedbacks.length > 100) {
      feedbacks.pop();
    }

    console.log(`[Feedback] 收到反馈 #${feedback.id}:`, feedback.content.slice(0, 50));

    return NextResponse.json({
      success: true,
      message: "感谢您的反馈！我们会认真对待每一条建议 🙏",
    });
  } catch (err) {
    console.error("[Feedback] 处理反馈失败:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}