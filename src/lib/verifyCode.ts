/**
 * 验证码存储（内存 Map）
 * key: email
 * value: { code: string, expiresAt: number }
 */
const codeStore = new Map<string, { code: string; expiresAt: number }>();

/** 验证码有效期（毫秒） */
const CODE_TTL = 5 * 60 * 1000; // 5 分钟

/** 定期清理过期验证码（每 60 秒） */
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of codeStore.entries()) {
    if (now > record.expiresAt) {
      codeStore.delete(email);
    }
  }
}, 60_000);

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