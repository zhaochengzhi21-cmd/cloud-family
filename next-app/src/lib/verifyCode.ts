/**
 * 验证码存储（Vercel KV / Redis）
 *
 * 使用 @upstash/redis 连接 Vercel KV，确保在 Vercel Serverless 多实例环境下共享。
 * 验证码自动 5 分钟过期。
 *
 * key 格式: verifycode:{email}
 * value: 6位数字验证码
 * ttl: 300秒（5分钟）
 */

import { createClient } from "./kvClient";

/** 日志前缀 */
const LOG = "[VerifyCode]";

// 自动选择 KV 客户端
const kv = createClient();

/** 验证码有效期（秒） */
const CODE_TTL = 300; // 5 分钟

/**
 * 存储验证码并返回验证码
 * 存储完成后会立即读取确认。
 */
export async function storeCode(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const key = `verifycode:${normalizedEmail}`;
  const code = String(Math.floor(100000 + Math.random() * 900000));

  console.log(`${LOG} 📝 存储验证码:`);
  console.log(`${LOG}    key   = ${key}`);
  console.log(`${LOG}    code  = ${code}`);
  console.log(`${LOG}    ttl   = ${CODE_TTL}s`);

  // 存储到 KV
  await kv.set(key, code, { ex: CODE_TTL });
  console.log(`${LOG} ✅ set() 完成`);

  // 立即读取确认
  const readBack = await kv.get<string>(key);
  console.log(`${LOG} 🔍 读取确认: readBack = ${readBack === null ? "null" : readBack}`);

  if (readBack === null) {
    console.error(`${LOG} ❌ 严重: 验证码存储后立即读取却返回 null！`);
    console.error(`${LOG}    这可能表示 KV 连接有问题或 key 格式不匹配`);
  } else if (readBack === code) {
    console.log(`${LOG} ✅ 验证码存储验证通过: 写入与读取一致`);
  } else {
    console.error(`${LOG} ⚠️  验证码存储验证异常: 写入=${code}, 读取=${readBack}`);
  }

  return code;
}

/**
 * 验证验证码
 * 验证成功后自动删除，防止重复使用。
 */
export async function verifyCode(email: string, inputCode: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const key = `verifycode:${normalizedEmail}`;

  console.log(`${LOG} 🔍 验证验证码:`);
  console.log(`${LOG}    key       = ${key}`);
  console.log(`${LOG}    inputCode = ${inputCode}`);

  const storedCodeRaw = await kv.get(key);
  let storedCode: string | null = null;
  if (storedCodeRaw === null || storedCodeRaw === undefined) {
    storedCode = null;
  } else {
    const raw = String(storedCodeRaw).trim();
    // 去除 JSON 字符串的首尾引号（兼容 @upstash/redis v1.x 的反序列化差异）
    storedCode = raw.replace(/^"|"$/g, "");
  }
  console.log(`${LOG}    storedCodeRaw = ${JSON.stringify(storedCodeRaw)}`);
  console.log(`${LOG}    storedCode    = ${storedCode === null ? "null" : storedCode}`);
  console.log(`${LOG}    storedCode类型 = ${typeof storedCodeRaw}, inputCode类型 = ${typeof inputCode}`);

  if (!storedCode) {
    console.error(`${LOG} ❌ 验证码不存在或已过期: key=${key}`);

    // 尝试列出所有 verifycode 开头的 key 用于调试
    try {
      const allKeys = await kv.keys("verifycode:*");
      console.log(`${LOG} 📋 当前所有 verifycode key: ${JSON.stringify(allKeys)}`);
    } catch (e) {
      console.error(`${LOG} ⚠️  列出 key 失败:`, e);
    }

    return false;
  }

  if (storedCode !== inputCode) {
    console.error(`${LOG} ❌ 验证码不匹配: 输入=${inputCode}, 期望=${storedCode}`);
    return false;
  }

  // 验证成功，删除验证码防止重复使用
  await kv.del(key);
  console.log(`${LOG} ✅ 验证成功，已删除验证码 key=${key}`);
  return true;
}