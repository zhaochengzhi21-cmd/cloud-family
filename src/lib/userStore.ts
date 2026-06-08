/**
 * 用户数据存储（内存 Map）
 * 
 * 注意：在 Vercel Serverless 环境下，每次冷启动会重新加载此模块。
 * 生产环境建议使用数据库（如 Vercel KV、PostgreSQL 等）替代。
 * 
 * key: emailHash (sha256)
 * value: UserRecord
 */

interface UserRecord {
  emailHash: string;
  registeredAt: string;
  lastLoginAt: string;
}

/** 全局用户存储 */
const globalStore = globalThis as any;
if (!globalStore.__users) {
  globalStore.__users = new Map<string, UserRecord>();
}
const usersMap: Map<string, UserRecord> = globalStore.__users;

/**
 * 读取所有用户
 */
export function getAllUsers(): UserRecord[] {
  return Array.from(usersMap.values());
}

/**
 * 根据 emailHash 查找用户
 */
export function findUser(emailHash: string): UserRecord | undefined {
  return usersMap.get(emailHash);
}

/**
 * 创建新用户
 */
export function createUser(emailHash: string): UserRecord {
  const now = new Date().toISOString();
  const user: UserRecord = {
    emailHash,
    registeredAt: now,
    lastLoginAt: now,
  };
  usersMap.set(emailHash, user);
  return user;
}

/**
 * 更新用户最后登录时间
 */
export function updateLoginTime(emailHash: string): void {
  const user = usersMap.get(emailHash);
  if (user) {
    user.lastLoginAt = new Date().toISOString();
    usersMap.set(emailHash, user);
  }
}