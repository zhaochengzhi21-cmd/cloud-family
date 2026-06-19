import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * 环境变量调试接口（仅生产/预览环境可用）
 *
 * GET /api/debug-kv-env
 * 返回所有已配置环境变量的状态以及 KV 连接测试结果
 */
export async function GET() {
  const envVars: Record<string, string | undefined> = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    PINATA_JWT: process.env.PINATA_JWT,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ALCHEMY_POLYGON_RPC_URL: process.env.ALCHEMY_POLYGON_RPC_URL,
    CONTRACT_PRIVATE_KEY: process.env.CONTRACT_PRIVATE_KEY,
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
    RESTORATION_API_KEY: process.env.RESTORATION_API_KEY,
    BAIDU_OCR_API_KEY: process.env.BAIDU_OCR_API_KEY,
    BAIDU_OCR_SECRET: process.env.BAIDU_OCR_SECRET,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    KV_URL: process.env.KV_URL,
  };

  const result: Record<string, { defined: boolean; masked: string | null }> =
    {};

  for (const [key, value] of Object.entries(envVars)) {
    if (value && value.length > 0) {
      const prefix = value.slice(0, 4);
      const suffix = value.slice(-4);
      result[key] = {
        defined: true,
        masked: `${prefix}****${suffix}`,
      };
    } else {
      result[key] = {
        defined: false,
        masked: null,
      };
    }
  }

  // KV 连接测试
  let kvTest: Record<string, unknown> = {
    attempted: false,
    success: false,
    error: null,
    ping: null,
    writeReadTest: null,
  };

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (url && token) {
      kvTest.attempted = true;
      const kv = new Redis({ url, token });

      // Ping
      const pingResult = await kv.ping();
      kvTest.ping = pingResult;

      // 写入/读取测试
      const testKey = "debug:test:" + Date.now();
      const testValue = "hello_kv_" + Math.random().toString(36).slice(2);
      await kv.set(testKey, testValue, { ex: 60 });
      const readBack = await kv.get<string>(testKey);
      await kv.del(testKey);

      kvTest.writeReadTest = readBack === testValue ? "PASS" : `FAIL: wrote=${testValue}, read=${readBack}`;
      kvTest.success = readBack === testValue;
    }
  } catch (err) {
    kvTest.error = err instanceof Error ? err.message : String(err);
    kvTest.success = false;
  }

  return NextResponse.json({
    success: true,
    message:
      "环境变量状态（值已遮蔽，仅显示前后各4位）。如果某个变量显示 defined: false，说明 Vercel 上未配置或变量名不匹配。",
    variables: result,
    kvTest,
    totalDefined: Object.values(result).filter((v) => v.defined).length,
    totalUndefined: Object.values(result).filter((v) => !v.defined).length,
  });
};