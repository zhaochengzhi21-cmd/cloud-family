/**
 * KV 存储客户端
 *
 * 使用 @upstash/redis 通过 REST API 连接 Upstash Redis（Vercel KV）。
 * 这是 @vercel/kv 的底层库，避免了 @vercel/kv v3 ESM-only 的兼容问题。
 *
 * 必须设置以下环境变量之一：
 * - KV_REST_API_URL + KV_REST_API_TOKEN（Vercel KV 自动注入）
 * - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN（直接指定）
 */

import { Redis } from "@upstash/redis";

/** 日志前缀 */
const LOG = "[KV-Client]";

/** 单例 KV 客户端 */
let kvClient: Redis | null = null;

/**
 * 获取 Redis 连接 URL
 */
function getRedisUrl(): string | null {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
}

/**
 * 获取 Redis 连接 Token
 */
function getRedisToken(): string | null {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;
}

/**
 * 获取 Upstash Redis 客户端（单例）
 */
export function getKv(): Redis {
  if (kvClient) return kvClient;

  const url = getRedisUrl();
  const token = getRedisToken();

  if (!url || !token) {
    console.error(`${LOG} ❌ KV 环境变量未设置！`);
    console.error(`${LOG}    需要 KV_REST_API_URL 或 UPSTASH_REDIS_REST_URL`);
    console.error(`${LOG}    需要 KV_REST_API_TOKEN 或 UPSTASH_REDIS_REST_TOKEN`);
    console.error(`${LOG}    当前 URL: ${url ? "✅" : "❌"}, Token: ${token ? "✅" : "❌"}`);
    throw new Error(
      "KV 数据库未配置。请先在 Vercel Dashboard 创建 KV 数据库并关联项目。"
    );
  }

  console.log(`${LOG} ✅ 正在连接 Upstash Redis: ${url.replace(/https?:\/\//, "").split(".")[0]}...`);

  kvClient = new Redis({
    url,
    token,
    automaticDeserialization: true,
  });

  // 测试连接
  pingKv(kvClient);

  return kvClient;
}

/**
 * 测试 KV 连接（异步，不阻塞）
 */
async function pingKv(kv: Redis): Promise<void> {
  try {
    const result = await kv.ping();
    console.log(`${LOG} ✅ KV 连接测试通过: ${result}`);
  } catch (err) {
    console.error(`${LOG} ⚠️  KV 连接测试失败:`, err instanceof Error ? err.message : String(err));
    console.error(`${LOG}     KV 可能暂时不可用，请求将继续但可能失败`);
  }
}

// ========== 兼容旧接口的简单封装 ==========

export interface KvClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

/** 判断 KV 是否可用 */
export function isKvAvailable(): boolean {
  return !!(getRedisUrl() && getRedisToken());
}

/** KV 环境变量名称提示 */
export const KV_ENV_NAMES = {
  url: "KV_REST_API_URL",
  token: "KV_REST_API_TOKEN",
  readOnlyToken: "KV_REST_API_READ_ONLY_TOKEN",
} as const;

/**
 * 创建 KV 客户端（兼容旧接口）
 * 注意：如果环境变量缺失会直接抛出错误，不会 fallback 到内存存储。
 */
export function createClient(): KvClient {
  const kv = getKv();

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      try {
        const val = await kv.get<T>(key);
        return val ?? null;
      } catch (err) {
        console.error(`${LOG} ❌ get 失败 key=${key}:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    },

    async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
      try {
        if (opts?.ex) {
          await kv.set(key, value, { ex: opts.ex });
        } else {
          await kv.set(key, value);
        }
      } catch (err) {
        console.error(`${LOG} ❌ set 失败 key=${key}:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    async del(key: string): Promise<void> {
      try {
        await kv.del(key);
      } catch (err) {
        console.error(`${LOG} ❌ del 失败 key=${key}:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    async keys(pattern: string): Promise<string[]> {
      try {
        return await kv.keys(pattern);
      } catch (err) {
        console.error(`${LOG} ❌ keys 失败 pattern=${pattern}:`, err instanceof Error ? err.message : String(err));
        return [];
      }
    },
  };
}