import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "@/lib/verifyCode";
import { findUser, createUser, updateLoginTime } from "@/lib/userStore";
import jwt from "jsonwebtoken";
import crypto from "crypto";

/** JWT 密钥（如未配置则使用默认值，生产环境请务必修改） */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** Token 有效期 */
const TOKEN_EXPIRY = "7d";

/**
 * 计算邮箱哈希值
 */
function hashEmail(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

/**
 * 邮箱注册/登录 API
 *
 * 使用验证码进行邮箱注册和登录，返回 JWT token 并设置 httpOnly cookie。
 *
 * POST /api/auth
 * Body: { email: string, code: string, action: "register" | "login" }
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code, action } = await request.json();

    // 校验参数
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return NextResponse.json(
        { success: false, error: "请提供有效的邮箱地址" },
        { status: 400 }
      );
    }

    if (!code || typeof code !== "string" || code.length !== 6) {
      return NextResponse.json(
        { success: false, error: "请提供有效的6位验证码" },
        { status: 400 }
      );
    }

    if (!action || !["register", "login"].includes(action)) {
      return NextResponse.json(
        { success: false, error: "请指定操作为 register 或 login" },
        { status: 400 }
      );
    }

    const emailHash = hashEmail(email);
    const existingUser = await findUser(emailHash);

    // 检查用户状态（在验证验证码之前先判断业务逻辑）
    if (action === "register") {
      if (existingUser) {
        return NextResponse.json(
          { success: false, error: "该邮箱已注册，请直接登录" },
          { status: 409 }
        );
      }
    } else {
      // login
      if (!existingUser) {
        return NextResponse.json(
          { success: false, error: "该邮箱尚未注册，请先注册" },
          { status: 404 }
        );
      }
    }

    // 验证验证码（放在业务逻辑判断之后，只验证一次）
    if (!(await verifyCode(email, code))) {
      return NextResponse.json(
        { success: false, error: "验证码错误或已过期" },
        { status: 401 }
      );
    }

    // 执行业务操作
    if (action === "register") {
      await createUser(emailHash);
    } else {
      await updateLoginTime(emailHash);
    }

    // 生成 JWT
    const token = jwt.sign(
      {
        emailHash,
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    // 构建响应
    const response = NextResponse.json({
      success: true,
      message: action === "register" ? "注册成功" : "登录成功",
      data: {
        emailHash,
        isNewUser: action === "register",
      },
    });

    // 设置 httpOnly cookie
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 天（秒）
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("认证 API 错误:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}