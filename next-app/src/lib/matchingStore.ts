/**
 * 家族关联匹配数据存储
 *
 * 使用 KV 存储匹配兴趣、连接和匿名消息。
 * 消息数据自动在 30 天后过期。
 *
 * Key 格式:
 *   match:interest:{familyId}:{targetFamilyId} → { emailHash, createdAt, iAmInterested: true }
 *   match:connection:{familyId}:{targetFamilyId} → { connectedAt, active: true }
 *   match:dismissed:{familyId}:{matchFamilyId} → { dismissedAt }
 *   match:newResult:{familyId}:{matchFamilyId} → { matchedAt, showed: false }
 *   message:{connectionId}:{msgId} → { from, content, createdAt } (TTL: 30天)
 *   message:list:{connectionId} → string[] (消息ID列表, TTL: 30天)
 */

import { createClient } from "./kvClient";

const kv = createClient();

const THIRTY_DAYS = 30 * 24 * 60 * 60; // 秒

/* ========== 类型定义 ========== */

export interface MatchInterest {
  emailHash: string;
  familyId: string;
  targetFamilyId: string;
  createdAt: string;
  iAmInterested: boolean;
}

export interface MatchConnection {
  familyIdA: string;
  familyIdB: string;
  connectedAt: string;
  familyAName: string;
  familyBName: string;
  active: boolean;
}

export interface MatchDismissed {
  familyId: string;
  matchFamilyId: string;
  dismissedAt: string;
}

export interface MatchNewResult {
  familyId: string;
  matchFamilyId: string;
  matchedAt: string;
  showed: boolean;
}

export interface AnonymousMessage {
  msgId: string;
  connectionId: string;
  from: string; // emailHash of sender
  to: string;   // emailHash of receiver
  content: string;
  createdAt: string;
}

/* ========== 匹配兴趣 ========== */

/**
 * 标记"我有兴趣"
 */
export async function expressInterest(
  familyId: string,
  targetFamilyId: string,
  emailHash: string
): Promise<void> {
  const key = `match:interest:${familyId}:${targetFamilyId}`;
  await kv.set(key, {
    emailHash,
    familyId,
    targetFamilyId,
    createdAt: new Date().toISOString(),
    iAmInterested: true,
  });
}

/**
 * 取消兴趣
 */
export async function withdrawInterest(
  familyId: string,
  targetFamilyId: string
): Promise<void> {
  const key = `match:interest:${familyId}:${targetFamilyId}`;
  await kv.del(key);
}

/**
 * 获取某家族对某目标家族的兴趣标记
 */
export async function getInterest(
  familyId: string,
  targetFamilyId: string
): Promise<MatchInterest | null> {
  return kv.get<MatchInterest>(`match:interest:${familyId}:${targetFamilyId}`);
}

/**
 * 检查是否互相有兴趣
 */
export async function checkMutualInterest(
  familyIdA: string,
  familyIdB: string
): Promise<boolean> {
  const interestA = await getInterest(familyIdA, familyIdB);
  const interestB = await getInterest(familyIdB, familyIdA);
  return !!(interestA?.iAmInterested && interestB?.iAmInterested);
}

/* ========== 匹配连接 ========== */

function getConnectionId(familyIdA: string, familyIdB: string): string {
  // 排序确保一致性
  const sorted = [familyIdA, familyIdB].sort();
  return `${sorted[0]}:${sorted[1]}`;
}

/**
 * 建立连接（双方都点了"我有兴趣"）
 */
export async function establishConnection(
  familyIdA: string,
  familyIdB: string,
  familyAName: string,
  familyBName: string
): Promise<void> {
  const connectionId = getConnectionId(familyIdA, familyIdB);
  const connection: MatchConnection = {
    familyIdA,
    familyIdB,
    connectedAt: new Date().toISOString(),
    familyAName,
    familyBName,
    active: true,
  };
  // 存入正反两个方向方便查询
  await kv.set(`match:connection:${familyIdA}:${familyIdB}`, connection);
  await kv.set(`match:connection:${familyIdB}:${familyIdA}`, connection);
  // 同时存一份按 connectionId 索引的
  await kv.set(`match:connection:${connectionId}`, connection);
}

/**
 * 断开连接（退出匿名沟通）
 */
export async function disconnectConnection(
  familyIdA: string,
  familyIdB: string
): Promise<void> {
  const connectionId = getConnectionId(familyIdA, familyIdB);

  // 清除连接记录
  await kv.del(`match:connection:${familyIdA}:${familyIdB}`);
  await kv.del(`match:connection:${familyIdB}:${familyIdA}`);
  await kv.del(`match:connection:${connectionId}`);

  // 清除双方的兴趣标记
  await kv.del(`match:interest:${familyIdA}:${familyIdB}`);
  await kv.del(`match:interest:${familyIdB}:${familyIdA}`);

  // 清除消息列表和消息内容
  const msgListKey = `message:list:${connectionId}`;
  const msgIds = await kv.get<string[]>(msgListKey);
  if (msgIds && Array.isArray(msgIds)) {
    for (const msgId of msgIds) {
      await kv.del(`message:${connectionId}:${msgId}`);
    }
  }
  await kv.del(msgListKey);
}

/**
 * 获取两个家族之间的连接信息（如果存在）
 */
export async function getConnection(
  familyIdA: string,
  familyIdB: string
): Promise<MatchConnection | null> {
  return kv.get<MatchConnection>(`match:connection:${familyIdA}:${familyIdB}`);
}

/**
 * 获取某家族的所有活跃连接
 */
export async function getFamilyConnections(
  familyId: string
): Promise<MatchConnection[]> {
  const keys = await kv.keys(`match:connection:${familyId}:*`);
  const connections = await Promise.all(
    keys.map((key) => kv.get<MatchConnection>(key))
  );
  return connections.filter(
    (c): c is MatchConnection => c !== null && c.active
  );
}

/* ========== 匹配新结果标记 ========== */

/**
 * 记录新的匹配结果（用于通知栏展示）
 */
export async function recordNewMatchResult(
  familyId: string,
  matchFamilyId: string
): Promise<void> {
  const key = `match:newResult:${familyId}:${matchFamilyId}`;
  const existing = await kv.get<MatchNewResult>(key);
  if (!existing) {
    await kv.set(key, {
      familyId,
      matchFamilyId,
      matchedAt: new Date().toISOString(),
      showed: false,
    });
  }
}

/**
 * 获取某家族的所有未读匹配结果
 */
export async function getNewMatchResults(
  familyId: string
): Promise<MatchNewResult[]> {
  const keys = await kv.keys(`match:newResult:${familyId}:*`);
  const results = await Promise.all(
    keys.map((key) => kv.get<MatchNewResult>(key))
  );
  return results.filter(
    (r): r is MatchNewResult => r !== null && !r.showed
  );
}

/**
 * 标记匹配结果已处理
 */
export async function dismissMatchResult(
  familyId: string,
  matchFamilyId: string
): Promise<void> {
  const key = `match:newResult:${familyId}:${matchFamilyId}`;
  await kv.del(key);
}

/* ========== 匿名消息 ========== */

/**
 * 发送匿名消息
 */
export async function sendAnonymousMessage(
  familyIdA: string,
  familyIdB: string,
  fromEmailHash: string,
  content: string
): Promise<AnonymousMessage> {
  const connectionId = getConnectionId(familyIdA, familyIdB);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const message: AnonymousMessage = {
    msgId,
    connectionId,
    from: fromEmailHash,
    to: "", // 将在发送时确定
    content,
    createdAt: now,
  };

  // 存入消息内容（30天过期）
  await kv.set(`message:${connectionId}:${msgId}`, message, { ex: THIRTY_DAYS });

  // 追加到消息列表（30天过期）
  const msgListKey = `message:list:${connectionId}`;
  const existingIds = await kv.get<string[]>(msgListKey) || [];
  existingIds.push(msgId);
  await kv.set(msgListKey, existingIds, { ex: THIRTY_DAYS });

  return message;
}

/**
 * 获取连接的全部聊天记录
 */
export async function getMessages(
  familyIdA: string,
  familyIdB: string
): Promise<AnonymousMessage[]> {
  const connectionId = getConnectionId(familyIdA, familyIdB);
  const msgListKey = `message:list:${connectionId}`;
  const msgIds = await kv.get<string[]>(msgListKey);

  if (!msgIds || !Array.isArray(msgIds) || msgIds.length === 0) {
    return [];
  }

  const messages = await Promise.all(
    msgIds.map((id) => kv.get<AnonymousMessage>(`message:${connectionId}:${id}`))
  );

  return messages
    .filter((m): m is AnonymousMessage => m !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}