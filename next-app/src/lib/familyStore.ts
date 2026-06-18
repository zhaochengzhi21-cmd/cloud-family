/**
 * 家族数据存储（Vercel KV / Redis）
 *
 * 使用 @vercel/kv 存储家族关联记录和元数据。
 * 当 KV 不可用时自动 fallback 到内存。
 *
 * key 格式:
 *   family:binding:{familyId}     → { emailHash, familyName, createdAt }
 *   family:meta:{familyId}        → { familyName, creatorEmailHash, editors[], createdAt, searchable, memberCount? }
 */

import { createClient } from "./kvClient";

// 自动选择 KV 客户端
const kv = createClient();

/* ========== 类型 ========== */

export interface FamilyBinding {
  emailHash: string;
  familyId: string;
  familyName: string;
  createdAt: string;
}

export interface FamilyMeta {
  familyId: string;
  familyName: string;
  creatorEmailHash: string;
  editors: string[];
  createdAt: string;
  searchable?: boolean;
  memberCount?: number;
  /** 是否开启家族关联匹配 */
  enableMatching?: boolean;
}

/* ========== 家族关联记录（binding）========== */

/**
 * 写入家族关联记录（谁创建了哪个家族）
 */
export async function writeFamilyBinding(
  emailHash: string,
  familyId: string,
  familyName: string
): Promise<void> {
  const binding: FamilyBinding = {
    emailHash,
    familyId,
    familyName,
    createdAt: new Date().toISOString(),
  };
  await kv.set(`family:binding:${familyId}`, binding);
}

/**
 * 读取某个家族的关联记录
 */
export async function getFamilyBinding(
  familyId: string
): Promise<FamilyBinding | null> {
  return kv.get<FamilyBinding>(`family:binding:${familyId}`);
}

/* ========== 家族元数据（meta）========== */

/**
 * 写入家族元数据（首次创建时）
 */
export async function writeCreatorMeta(
  emailHash: string,
  familyId: string,
  familyName: string,
  searchable: boolean = false
): Promise<void> {
  // 先检查是否已有元数据
  const existing = await kv.get<FamilyMeta>(`family:meta:${familyId}`);
  if (existing) {
    // 只更新 searchable
    existing.searchable = searchable;
    await kv.set(`family:meta:${familyId}`, existing);
    return;
  }

  const meta: FamilyMeta = {
    familyId,
    familyName,
    creatorEmailHash: emailHash,
    editors: [],
    createdAt: new Date().toISOString(),
    searchable,
    enableMatching: false,
  };
  await kv.set(`family:meta:${familyId}`, meta);
}

/**
 * 更新家族成员数量
 */
export async function updateFamilyMetaMemberCount(
  familyId: string,
  memberCount: number
): Promise<void> {
  const meta = await kv.get<FamilyMeta>(`family:meta:${familyId}`);
  if (meta) {
    meta.memberCount = memberCount;
    await kv.set(`family:meta:${familyId}`, meta);
  }
}

/**
 * 读取单个家族元数据
 */
export async function getFamilyMeta(
  familyId: string
): Promise<FamilyMeta | null> {
  return kv.get<FamilyMeta>(`family:meta:${familyId}`);
}

/**
 * 读取所有家族元数据（用于搜索功能）
 * 注意：生产环境大量数据时应使用 scan/分页方案
 */
export async function getAllFamilyMeta(): Promise<FamilyMeta[]> {
  const keys = await kv.keys("family:meta:*");
  if (!keys.length) return [];
  const metas = await Promise.all(
    keys.map((key) => kv.get<FamilyMeta>(key))
  );
  return metas.filter((m): m is FamilyMeta => m !== null);
}

/**
 * 获取用户创建或参与的家族列表
 */
export async function getUserFamilies(
  emailHash: string
): Promise<{ binding?: FamilyBinding; meta?: FamilyMeta }[]> {
  const keys = await kv.keys("family:binding:*");
  const bindings = (
    await Promise.all(
      keys.map((key) => kv.get<FamilyBinding>(key))
    )
  ).filter((b): b is FamilyBinding => b !== null && b.emailHash === emailHash);

  const results: { binding?: FamilyBinding; meta?: FamilyMeta }[] = [];
  for (const binding of bindings) {
    const meta = await kv.get<FamilyMeta>(`family:meta:${binding.familyId}`);
    results.push({ binding, meta: meta ?? undefined });
  }
  return results;
}

/**
 * 获取用户作为编辑者参与的家族
 */
export async function getUserEditedFamilies(
  emailHash: string
): Promise<FamilyMeta[]> {
  const keys = await kv.keys("family:meta:*");
  const metas = (
    await Promise.all(
      keys.map((key) => kv.get<FamilyMeta>(key))
    )
  ).filter(
    (m): m is FamilyMeta =>
      m !== null && m.editors.includes(emailHash)
  );
  return metas;
}