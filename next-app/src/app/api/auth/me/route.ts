import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "@/lib/jwtSecret";

/**
 * GET /api/auth/me
 *
 * 从 httpOnly cookie 中读取 token，验证后返回用户信息。
 * 前端在页面加载时调用此接口恢复登录状态。
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "未登录" },
        { status: 401 }
      );
    }

    // 验证 JWT（缺少 JWT_SECRET 时明确失败，不使用默认密钥）
    const decoded = jwt.verify(token, getJwtSecret()) as {
      emailHash: string;
      iat: number;
      exp: number;
    };

    if (!decoded || !decoded.emailHash) {
      return NextResponse.json(
        { success: false, error: "Token 无效" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        emailHash: decoded.emailHash,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("JWT_SECRET 未配置")) {
      console.error("Auth me error: JWT_SECRET 未配置");
      return NextResponse.json(
        { success: false, error: "服务器认证配置不完整" },
        { status: 500 }
      );
    }
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "TokenExpiredError") {
      return NextResponse.json(
        { success: false, error: "Token 已过期" },
        { status: 401 }
      );
    }
    console.error("Auth me error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
