/**
 * KV 存储客户端工厂
 *
 * 自动检测 Vercel KV 环境变量是否存在：
 * - 如果 KV_REST_API_URL 和 KV_REST_API_TOKEN 存在 → 使用 @vercel/kv
 * - 否则 → 使用内存 Map fallback（适合本地开发 / 未配置 KV 的环境）
 *
 * 内存 fallback 在 Serverless 多实例下不共享数据，但至少不会 500 报错。
 * 生产环境请务必在 Vercel Dashboard 创建 KV 数据库并关联项目。
 */

// ========== 内存 KV 实现（fallback）==========

interface MemoryKvOptions {
  ex?: number; // 过期时间（秒）
}

interface MemoryKvEntry {
  value: unknown;
  expiresAt: number | null; // 过期时间戳（ms），null 表示永不过期
}

class MemoryKv {
  private store = new Map<string, MemoryKvEntry>();

  constructor() {
    // 每分钟清理过期数据
    setInterval(() => this.cleanup(), 60_000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    // 检查是否过期
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, opts?: MemoryKvOptions): Promise<void> {
    const expiresAt =
      opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return Array.from(this.store.keys()).filter((k) => regex.test(k));
  }
}

// ========== @vercel/kv 包装器 ==========

class VercelKvWrapper {
  private kv: any;

  constructor() {
    // 动态导入，避免未配置 KV 时启动崩溃
    const vercelKv = require("@vercel/kv");
    this.kv = vercelKv.kv;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.kv.get(key) as Promise<T | null>;
  }

  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    if (opts?.ex) {
      await this.kv.set(key, value, { ex: opts.ex });
    } else {
      await this.kv.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.kv.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.kv.keys(pattern) as Promise<string[]>;
  }
}

// ========== 统一的类型接口 ==========

export interface KvClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

/** KV 是否可用（环境变量已配置） */
export function isKvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** KV 环境变量名称提示 */
export const KV_ENV_NAMES = {
  url: "KV_REST_API_URL",
  token: "KV_REST_API_TOKEN",
  readOnlyToken: "KV_REST_API_READ_ONLY_TOKEN",
} as const;

// ========== 工厂函数 ==========

/**
 * 创建 KV 客户端，自动检测环境：
 * - 有 KV_REST_API_URL + KV_REST_API_TOKEN → @vercel/kv
 * - 否则 → 内存 fallback
 */
export function createClient(): KvClient {
  if (isKvAvailable()) {
    console.log("[KV] 检测到 Vercel KV 环境变量，使用 @vercel/kv");
    return new VercelKvWrapper();
  }
  console.log(
    "[KV] 未检测到 KV 环境变量，使用内存存储（数据不跨实例共享）"
  );
  return new MemoryKv();
}