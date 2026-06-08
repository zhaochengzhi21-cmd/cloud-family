/**
 * 验证码存储（Vercel KV / Redis）
 *
 * 使用 @vercel/kv 存储验证码，确保在 Vercel Serverless 多实例环境下共享。
 * 验证码自动 5 分钟过期。
 *
 * key 格式: verifycode:{email}
 * value: 6位数字验证码
 * ttl: 300秒（5分钟）
 */

import { kv } from "@vercel/kv";

/** 验证码有效期（秒） */
const CODE_TTL = 300; // 5 分钟

/**
 * 存储验证码并返回验证码
 */
export async function storeCode(email: string): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await kv.set(`verifycode:${email.toLowerCase().trim()}`, code, { ex: CODE_TTL });
  return code;
}

/**
 * 验证验证码
 * 验证成功后自动删除，防止重复使用。
 */
export async function verifyCode(email: string, inputCode: string): Promise<boolean> {
  const key = `verifycode:${email.toLowerCase().trim()}`;
  const storedCode = await kv.get<string>(key);
  if (!storedCode) return false;
  if (storedCode !== inputCode) return false;
  // 验证成功，删除验证码防止重复使用
  await kv.del(key);
  return true;
}