/**
 * 匿名消息 API
 *
 * POST: 发送消息
 * GET: 获取聊天记录
 * DELETE: 断开连接并清除聊天记录
 */

import { NextRequest, NextResponse } from "next/server";
import {
  sendAnonymousMessage,
  getMessages,
  disconnectConnection,
  getConnection,
} from "@/lib/matchingStore";

/**
 * 从请求获取 emailHash
 */
async function getEmailHash(request: NextRequest): Promise<string | null> {
  try {
    const authRes = await fetch(
      `${request.nextUrl.protocol}//${request.nextUrl.host}/api/auth/me`,
      { headers: { cookie: request.headers.get("cookie") || "" } }
    );
    const authData = await authRes.json();
    if (authData.success && authData.data?.emailHash) {
      return authData.data.emailHash;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/family-matching/[familyId]/message
 *
 * Body: { targetFamilyId: string, content: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const { targetFamilyId, content } = await request.json();

    if (!targetFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少目标家族ID" },
        { status: 400 }
      );
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "消息内容不能为空" },
        { status: 400 }
      );
    }

    if (content.length > 2000) {
      return NextResponse.json(
        { success: false, error: "消息内容不能超过2000字符" },
        { status: 400 }
      );
    }

    // 验证用户身份
    const emailHash = await getEmailHash(request);
    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 验证连接是否存在
    const connection = await getConnection(familyId, targetFamilyId);
    if (!connection || !connection.active) {
      return NextResponse.json(
        { success: false, error: "连接不存在或已断开" },
        { status: 400 }
      );
    }

    // 发送消息（30天过期由 matchingStore 自动处理）
    const message = await sendAnonymousMessage(
      familyId,
      targetFamilyId,
      emailHash,
      content.trim()
    );

    return NextResponse.json({
      success: true,
      message: {
        msgId: message.msgId,
        content: message.content,
        from: message.from,
        createdAt: message.createdAt,
      },
    });
  } catch (err) {
    console.error("[matching-message] POST error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/family-matching/[familyId]/message?targetFamilyId=xxx
 *
 * 获取聊天记录
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const targetFamilyId = request.nextUrl.searchParams.get("targetFamilyId");

    if (!targetFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少目标家族ID" },
        { status: 400 }
      );
    }

    // 验证用户身份
    const emailHash = await getEmailHash(request);
    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 验证连接是否存在
    const connection = await getConnection(familyId, targetFamilyId);
    if (!connection || !connection.active) {
      return NextResponse.json(
        { success: false, error: "连接不存在或已断开" },
        { status: 400 }
      );
    }

    const messages = await getMessages(familyId, targetFamilyId);

    // 脱敏处理：对每条消息标记是否为自己发送的
    const safeMessages = messages.map((msg) => ({
      msgId: msg.msgId,
      content: msg.content,
      isMine: msg.from === emailHash,
      createdAt: msg.createdAt,
    }));

    return NextResponse.json({
      success: true,
      messages: safeMessages,
    });
  } catch (err) {
    console.error("[matching-message] GET error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/family-matching/[familyId]/message
 *
 * Body: { targetFamilyId: string }
 * 断开连接并清除所有聊天记录
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;
    const { targetFamilyId } = await request.json();

    if (!targetFamilyId) {
      return NextResponse.json(
        { success: false, error: "缺少目标家族ID" },
        { status: 400 }
      );
    }

    // 验证用户身份
    const emailHash = await getEmailHash(request);
    if (!emailHash) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 断开连接（清除聊天记录自动处理）
    await disconnectConnection(familyId, targetFamilyId);

    return NextResponse.json({
      success: true,
      message: "已断开连接，聊天记录已清除",
    });
  } catch (err) {
    console.error("[matching-message] DELETE error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}