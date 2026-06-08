/**
 * 验证码存储（全局内存 Map）
 * 
 * 注意：使用 globalThis 避免模块热重载时丢失数据。
 * 在 Vercel Serverless 环境下，不同实例间不共享此存储，
 * 生产环境建议使用 Redis/Vercel KV 替代。
 * 
 * key: email
 * value: { code: string, expiresAt: number }
 */

/** 验证码有效期（毫秒） */
const CODE_TTL = 5 * 60 * 1000; // 5 分钟

/** 使用 globalThis 保证全局唯一实例 */
const globalStore = globalThis as any;
if (!globalStore.__codeStore) {
  globalStore.__codeStore = new Map<string, { code: string; expiresAt: number }>();
}
const codeStore: Map<string, { code: string; expiresAt: number }> = globalStore.__codeStore;

/**
 * 存储验证码
 */
export function storeCode(email: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  codeStore.set(email, {
    code,
    expiresAt: Date.now() + CODE_TTL,
  });
  return code;
}

/**
 * 验证验证码（供其他路由调用）
 */
export function verifyCode(email: string, inputCode: string): boolean {
  const record = codeStore.get(email);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    codeStore.delete(email);
    return false;
  }
  const valid = record.code === inputCode;
  if (valid) {
    // 验证成功后清除验证码，防止重复使用
    codeStore.delete(email);
  }
  return valid;
}