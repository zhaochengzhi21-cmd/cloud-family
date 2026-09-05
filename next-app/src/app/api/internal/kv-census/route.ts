/**
 * TEMPORARY production KV census — CF-MIG-001A
 * DELETE after one controlled invocation. Do not leave in production.
 *
 * Auth: Authorization: Bearer <CF_KV_CENSUS_SECRET>
 * Returns aggregates only. Never returns keys, values, PII, CIDs, codes.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual, randomBytes } from "crypto";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  NextResponse.json({ success: false, error: "Not Found" }, { status: 404 });

function authorize(req: NextRequest): boolean {
  const secret = process.env.CF_KV_CENSUS_SECRET;
  if (!secret || secret.length < 32) return false;
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const provided = m[1].trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getReadRedis(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_READ_ONLY_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("KV not configured");
  }
  return new Redis({ url, token });
}

type NsStats = { count: number; ttl_count: number; persistent_count: number };

const KNOWN_NS = [
  "user",
  "verifycode",
  "family_binding",
  "family_meta",
  "editor_application",
  "editor_application_list",
  "matching_interest",
  "matching_connection",
  "matching_notification",
  "matching_dismissed",
  "matching_other",
  "message",
  "message_list",
  "my_families_cache",
  "family_other",
] as const;

type KnownNs = (typeof KNOWN_NS)[number];

function looksSensitiveToken(token: string): boolean {
  if (!token) return true;
  if (token.includes("@")) return true;
  if (/^0x[a-fA-F0-9]{8,}$/i.test(token)) return true;
  if (/^[a-f0-9]{32,}$/i.test(token)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))
    return true;
  if (token.length > 40) return true;
  return false;
}

function classifyKey(
  key: string,
  anonMap: Map<string, string>
): { kind: "known"; ns: KnownNs } | { kind: "unknown"; label: string } {
  if (key.startsWith("user:")) return { kind: "known", ns: "user" };
  if (key.startsWith("verifycode:")) return { kind: "known", ns: "verifycode" };
  if (key.startsWith("family:binding:")) return { kind: "known", ns: "family_binding" };
  if (key.startsWith("family:meta:")) return { kind: "known", ns: "family_meta" };
  if (key.startsWith("family:apply:list:"))
    return { kind: "known", ns: "editor_application_list" };
  if (key.startsWith("family:apply:")) return { kind: "known", ns: "editor_application" };
  if (key.startsWith("match:interest:")) return { kind: "known", ns: "matching_interest" };
  if (key.startsWith("match:connection:"))
    return { kind: "known", ns: "matching_connection" };
  if (key.startsWith("match:newResult:"))
    return { kind: "known", ns: "matching_notification" };
  if (key.startsWith("match:dismissed:"))
    return { kind: "known", ns: "matching_dismissed" };
  if (key.startsWith("match:")) return { kind: "known", ns: "matching_other" };
  if (key.startsWith("message:list:")) return { kind: "known", ns: "message_list" };
  if (key.startsWith("message:")) return { kind: "known", ns: "message" };
  if (key.startsWith("my-families:")) return { kind: "known", ns: "my_families_cache" };
  if (key.startsWith("family:")) return { kind: "known", ns: "family_other" };

  const token = key.split(":")[0] || "";
  if (looksSensitiveToken(token)) {
    const digest = createHash("sha256").update(token).digest("hex").slice(0, 12);
    if (!anonMap.has(digest)) {
      anonMap.set(digest, `UNKNOWN_NAMESPACE_HASH_${String(anonMap.size + 1).padStart(2, "0")}`);
    }
    return { kind: "unknown", label: anonMap.get(digest)! };
  }
  // Safe short first-token only
  return { kind: "unknown", label: `prefix:${token.slice(0, 24)}` };
}

function normalizeFamilyName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function scanAllKeys(redis: Redis): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const [next, batch] = await redis.scan(cursor, { count: 500 });
    cursor = typeof next === "string" ? Number(next) : next;
    if (Array.isArray(batch)) keys.push(...batch);
  } while (String(cursor) !== "0");
  return [...new Set(keys)];
}

/** GET intentionally absent as census — always 404 */
export async function GET() {
  return NOT_FOUND();
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NOT_FOUND();
  }

  // Reject any client-supplied patterns / commands in body
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && Object.keys(body as object).length > 0) {
      return NextResponse.json(
        { success: false, error: "empty body required" },
        { status: 400 }
      );
    }
  } catch {
    // empty body ok
  }

  let redis: Redis;
  try {
    redis = getReadRedis();
  } catch {
    return NextResponse.json(
      { success: false, error: "kv_unavailable" },
      { status: 503 }
    );
  }

  const allKeys = await scanAllKeys(redis);
  const anonMap = new Map<string, string>();
  const namespaces: Record<string, NsStats> = {};
  const ensureNs = (name: string) => {
    if (!namespaces[name]) {
      namespaces[name] = { count: 0, ttl_count: 0, persistent_count: 0 };
    }
    return namespaces[name];
  };

  const userKeys: string[] = [];
  const metaKeys: string[] = [];
  const bindingKeys: string[] = [];
  const verifyKeys: string[] = [];
  const interestKeys: string[] = [];
  const connectionKeys: string[] = [];
  const notificationKeys: string[] = [];
  const messageKeys: string[] = [];
  const messageListKeys: string[] = [];

  for (const key of allKeys) {
    const c = classifyKey(key, anonMap);
    const label = c.kind === "known" ? c.ns : c.label;
    const ns = ensureNs(label);
    ns.count++;

    // TTL — never GET for verifycode
    let ttl = -1;
    try {
      ttl = await redis.ttl(key);
    } catch {
      ttl = -3;
    }
    if (typeof ttl === "number" && ttl > 0) ns.ttl_count++;
    else if (ttl === -1) ns.persistent_count++;

    if (c.kind === "known") {
      if (c.ns === "user") userKeys.push(key);
      if (c.ns === "family_meta") metaKeys.push(key);
      if (c.ns === "family_binding") bindingKeys.push(key);
      if (c.ns === "verifycode") verifyKeys.push(key);
      if (c.ns === "matching_interest") interestKeys.push(key);
      if (c.ns === "matching_connection") connectionKeys.push(key);
      if (c.ns === "matching_notification") notificationKeys.push(key);
      if (c.ns === "message") messageKeys.push(key);
      if (c.ns === "message_list") messageListKeys.push(key);
    }
  }

  // Verify TTL buckets — TTL only, no GET
  const verifyTtl = { lt_5m: 0, m5_30m: 0, gt_30m: 0, persistent: 0, missing: 0 };
  for (const key of verifyKeys) {
    let ttl = -2;
    try {
      ttl = await redis.ttl(key);
    } catch {
      ttl = -3;
    }
    if (ttl === -1) verifyTtl.persistent++;
    else if (ttl === -2 || ttl < 0) verifyTtl.missing++;
    else if (ttl < 300) verifyTtl.lt_5m++;
    else if (ttl <= 1800) verifyTtl.m5_30m++;
    else verifyTtl.gt_30m++;
  }

  // Message/interest TTL active counts
  let messagesWithTtl = 0;
  let messagesPersistent = 0;
  for (const key of messageKeys) {
    const ttl = await redis.ttl(key).catch(() => -3);
    if (typeof ttl === "number" && ttl > 0) messagesWithTtl++;
    else if (ttl === -1) messagesPersistent++;
  }

  // Family / user aggregates — GET only server-side, never return payloads
  type MetaAgg = {
    familyId: string;
    creator?: string;
    editors: string[];
    searchable?: boolean;
    matching?: boolean;
    createdAt?: string;
    memberCount?: number;
    nameNorm: string;
    ok: boolean;
  };

  let malformed = 0;
  const metas: MetaAgg[] = [];
  for (const key of metaKeys) {
    try {
      const raw = await redis.get(key);
      if (raw == null || typeof raw !== "object") {
        malformed++;
        continue;
      }
      const obj = raw as Record<string, unknown>;
      const familyId =
        typeof obj.familyId === "string"
          ? obj.familyId
          : key.slice("family:meta:".length);
      const editors = Array.isArray(obj.editors)
        ? obj.editors.filter((e): e is string => typeof e === "string")
        : [];
      metas.push({
        familyId,
        creator: typeof obj.creatorEmailHash === "string" ? obj.creatorEmailHash : undefined,
        editors,
        searchable: obj.searchable === true ? true : obj.searchable === false ? false : undefined,
        matching: obj.enableMatching === true,
        createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
        memberCount: typeof obj.memberCount === "number" ? obj.memberCount : undefined,
        nameNorm: normalizeFamilyName(obj.familyName),
        ok: true,
      });
    } catch {
      malformed++;
    }
  }

  const bindingIds = new Set<string>();
  const bindingOwners = new Set<string>();
  for (const key of bindingKeys) {
    try {
      const raw = await redis.get(key);
      const familyId = key.slice("family:binding:".length);
      bindingIds.add(familyId);
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.emailHash === "string") bindingOwners.add(obj.emailHash);
      } else if (raw != null) {
        // unexpected shape
        malformed++;
      }
    } catch {
      malformed++;
    }
  }

  const metaIds = new Set(metas.map((m) => m.familyId));
  const creators = new Set(metas.map((m) => m.creator).filter(Boolean) as string[]);
  const editorsSet = new Set<string>();
  for (const m of metas) for (const e of m.editors) editorsSet.add(e);

  const userHashes = new Set(
    userKeys.map((k) => k.slice("user:".length)).filter(Boolean)
  );

  let usersWithBinding = 0;
  let usersWithoutFamily = 0;
  for (const h of userHashes) {
    const hasBinding = bindingOwners.has(h);
    const isCreator = creators.has(h);
    const isEditor = editorsSet.has(h);
    if (hasBinding || isCreator || isEditor) usersWithBinding++;
    else usersWithoutFamily++;
  }

  // Version heuristic: group by creator + normalized name
  const groups = new Map<string, MetaAgg[]>();
  let uncertain = 0;
  for (const m of metas) {
    if (!m.creator || !m.nameNorm) {
      uncertain++;
      continue;
    }
    const gk = `${m.creator}::${m.nameNorm}`;
    const arr = groups.get(gk) || [];
    arr.push(m);
    groups.set(gk, arr);
  }

  let likelyUnique = 0;
  let likelyDup = 0;
  for (const arr of groups.values()) {
    likelyUnique++;
    if (arr.length > 1) {
      // secondary: time proximity / memberCount proximity — still count extras as version dups
      likelyDup += arr.length - 1;
    }
  }

  const knownNsSet = new Set<string>(KNOWN_NS);
  let cloudFamilyKnownKeys = 0;
  let unknownKeys = 0;
  const unknownNamespaces: { normalized_prefix: string; count: number }[] = [];
  for (const [name, stats] of Object.entries(namespaces)) {
    if (knownNsSet.has(name)) cloudFamilyKnownKeys += stats.count;
    else {
      unknownKeys += stats.count;
      unknownNamespaces.push({ normalized_prefix: name, count: stats.count });
    }
  }

  // Drop any accidental large strings from response construction — only aggregates
  const response = {
    success: true,
    task: "CF-MIG-001A",
    scan_complete: true,
    total_keys: allKeys.length,
    cloud_family_known_keys: cloudFamilyKnownKeys,
    unknown_keys: unknownKeys,
    namespaces,
    unknown_namespaces: unknownNamespaces,
    malformed_record_count: malformed,
    users: {
      total: userKeys.length,
      with_family: usersWithBinding,
      without_family: usersWithoutFamily,
      owners: creators.size,
      editors: editorsSet.size,
      appearing_as_creator: [...creators].filter((h) => userHashes.has(h)).length,
      appearing_as_editor: [...editorsSet].filter((h) => userHashes.has(h)).length,
    },
    families: {
      meta: metaKeys.length,
      bindings: bindingKeys.length,
      distinct_family_ids: new Set([...metaIds, ...bindingIds]).size,
      searchable_true: metas.filter((m) => m.searchable === true).length,
      searchable_false: metas.filter((m) => m.searchable === false).length,
      matching_enabled: metas.filter((m) => m.matching).length,
      with_editors: metas.filter((m) => m.editors.length > 0).length,
      no_editors: metas.filter((m) => m.editors.length === 0).length,
      orphan_meta: [...metaIds].filter((id) => !bindingIds.has(id)).length,
      orphan_binding: [...bindingIds].filter((id) => !metaIds.has(id)).length,
    },
    version_estimate: {
      heuristic_only: true,
      likely_unique_family_groups: likelyUnique,
      likely_version_duplicates: likelyDup,
      uncertain_records: uncertain,
      confidence: metas.length === 0 ? "none" : metas.length < 20 ? "low" : "medium",
    },
    matching_messages: {
      interests: interestKeys.length,
      connections: connectionKeys.length,
      notifications: notificationKeys.length,
      messages: messageKeys.length,
      message_lists: messageListKeys.length,
      messages_with_ttl: messagesWithTtl,
      messages_persistent: messagesPersistent,
      content_read_or_printed: false,
    },
    verify_codes: {
      count: verifyKeys.length,
      values_read: false,
      ttl_summary: verifyTtl,
    },
    nonce: randomBytes(8).toString("hex"),
  };

  return NextResponse.json(response);
}
