import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "@/lib/verifyCode";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * 用户数据文件路径
 */
const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

/** JWT 密钥（如未配置则使用默认值，生产环境请务必修改） */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** Token 有效期 */
const TOKEN_EXPIRY = "7d";

/**
 * 用户记录接口
 */
interface UserRecord {
  emailHash: string;
  registeredAt: string;
  lastLoginAt: string;
}

/**
 * 读取用户数据
 */
function readUsers(): UserRecord[] {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * 写入用户数据
 */
function writeUsers(users: UserRecord[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

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

    // 验证验证码
    if (!verifyCode(email, code)) {
      return NextResponse.json(
        { success: false, error: "验证码错误或已过期" },
        { status: 401 }
      );
    }

    const emailHash = hashEmail(email);
    const users = readUsers();
    const existingUser = users.find((u) => u.emailHash === emailHash);
    const now = new Date().toISOString();

    if (action === "register") {
      if (existingUser) {
        return NextResponse.json(
          { success: false, error: "该邮箱已注册，请直接登录" },
          { status: 409 }
        );
      }

      // 创建新用户
      const newUser: UserRecord = {
        emailHash,
        registeredAt: now,
        lastLoginAt: now,
      };
      users.push(newUser);
      writeUsers(users);
    } else {
      // login
      if (!existingUser) {
        return NextResponse.json(
          { success: false, error: "该邮箱尚未注册，请先注册" },
          { status: 404 }
        );
      }

      // 更新最后登录时间
      existingUser.lastLoginAt = now;
      writeUsers(users);
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