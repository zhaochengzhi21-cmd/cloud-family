import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * 查看当前 KV 中存储的验证码（调试用，生产环境应移除）
 * GET /api/debug-kv-code?email=xxx
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return NextResponse.json({
      success: false,
      error: "KV 环境变量未设置",
      url: !!url,
      token: !!token,
    });
  }

  const kv = new Redis({ url, token });
  const normalizedEmail = email.toLowerCase().trim();
  const key = `verifycode:${normalizedEmail}`;

  try {
    // 直接读这个 key
    const storedCode = await kv.get<string>(key);
    
    // 同时尝试所有方法获取
    const storedCode2 = await kv.get(key as any);
    
    // 尝试用原始 key
    const storedCode3 = await kv.get(`verifycode:${normalizedEmail}`);
    
    // 尝试用 scan 查找
    let scanResult: any = null;
    try {
      const keys = await kv.keys("verifycode:*");
      scanResult = { keys, count: keys.length };
      
      // 对每个 key 尝试读取
      for (const k of keys) {
        const val = await kv.get<string>(k);
        scanResult[`value:${k}`] = val;
      }
    } catch (e) {
      scanResult = { error: String(e) };
    }

    // 尝试 TTL
    let ttl = null;
    try {
      ttl = await (kv as any).ttl(key);
    } catch (e) {
      ttl = `error: ${e}`;
    }

    return NextResponse.json({
      success: true,
      key,
      storedCode,
      storedCode2,
      storedCode3,
      ttl,
      scanResult,
      env: {
        url: url.slice(0, 20) + "...",
        hasToken: !!token,
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: String(err),
      key,
    });
  }
}