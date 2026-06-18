import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

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

    // 验证 JWT
    const decoded = jwt.verify(token, JWT_SECRET) as {
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
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
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