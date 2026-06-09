/**
 * 用户数据存储（Vercel KV / Redis）
 *
 * 使用 @vercel/kv 存储用户注册数据，确保在 Vercel Serverless 多实例环境下共享。
 * 当 KV 不可用时自动 fallback 到内存。
 *
 * key 格式: user:{emailHash}
 * value: UserRecord JSON
 */

import { createClient } from "./kvClient";

// 自动选择 KV 客户端：有环境变量用 @vercel/kv，否则用内存
const kv = createClient();

export interface UserRecord {
  emailHash: string;
  registeredAt: string;
  lastLoginAt: string;
}

/**
 * 根据 emailHash 查找用户
 */
export async function findUser(emailHash: string): Promise<UserRecord | undefined> {
  const data = await kv.get<UserRecord>(`user:${emailHash}`);
  return data ?? undefined;
}

/**
 * 创建新用户
 */
export async function createUser(emailHash: string): Promise<UserRecord> {
  const now = new Date().toISOString();
  const user: UserRecord = {
    emailHash,
    registeredAt: now,
    lastLoginAt: now,
  };
  await kv.set(`user:${emailHash}`, user);
  return user;
}

/**
 * 更新用户最后登录时间
 */
export async function updateLoginTime(emailHash: string): Promise<void> {
  const user = await findUser(emailHash);
  if (user) {
    user.lastLoginAt = new Date().toISOString();
    await kv.set(`user:${emailHash}`, user);
  }
}