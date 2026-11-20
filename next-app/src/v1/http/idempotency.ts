/**
 * Mutation idempotency for AI/agent retries.
 * Prefer Upstash KV when configured; otherwise process-local memory
 * (good enough for single-process local/e2e).
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isKvAvailable, getKv } from "@/lib/kvClient";
import { privateNoStoreHeaders } from "@/v1/http/origin";

const TTL_SEC = 24 * 60 * 60;
const KEY_RE = /^[A-Za-z0-9._:~-]{1,128}$/;

type Cached = {
  status: number;
  body: unknown;
  bodyHash: string;
};

const memory = new Map<string, { exp: number; value: Cached }>();

function memoryGet(key: string): Cached | null {
  const row = memory.get(key);
  if (!row) return null;
  if (Date.now() > row.exp) {
    memory.delete(key);
    return null;
  }
  return row.value;
}

function memorySet(key: string, value: Cached): void {
  memory.set(key, { exp: Date.now() + TTL_SEC * 1000, value });
  if (memory.size > 500) {
    const now = Date.now();
    for (const [k, v] of memory) {
      if (v.exp < now) memory.delete(k);
    }
  }
}

async function storeGet(key: string): Promise<Cached | null> {
  if (isKvAvailable()) {
    try {
      const raw = await getKv().get<Cached>(key);
      return raw ?? null;
    } catch {
      return memoryGet(key);
    }
  }
  return memoryGet(key);
}

async function storeSet(key: string, value: Cached): Promise<void> {
  memorySet(key, value);
  if (!isKvAvailable()) return;
  try {
    await getKv().set(key, value, { ex: TTL_SEC });
  } catch {
    /* memory already holds it for this process */
  }
}

export function readIdempotencyKey(req: NextRequest): string | null {
  const raw = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!raw) return null;
  return KEY_RE.test(raw) ? raw : "";
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex")
    .slice(0, 32);
}

/**
 * If Idempotency-Key is present, replay a prior success or record a new one.
 * Empty-string key → caller should 400. Missing key → run once with no cache.
 */
export async function withIdempotency(args: {
  req: NextRequest;
  userId: string;
  familyId: string;
  routeId: string;
  body: unknown;
  run: () => Promise<NextResponse>;
}): Promise<NextResponse> {
  const key = readIdempotencyKey(args.req);
  if (key === "") {
    return NextResponse.json(
      { success: false, code: "INVALID_IDEMPOTENCY_KEY" },
      { status: 400, headers: privateNoStoreHeaders() }
    );
  }
  if (!key) {
    return args.run();
  }

  const storageKey = `v1:idem:${args.userId}:${args.familyId}:${args.routeId}:${key}`;
  const bodyHash = hashRequestBody(args.body);
  const prior = await storeGet(storageKey);
  if (prior) {
    if (prior.bodyHash !== bodyHash) {
      return NextResponse.json(
        { success: false, code: "IDEMPOTENCY_KEY_REUSED" },
        { status: 409, headers: privateNoStoreHeaders() }
      );
    }
    return NextResponse.json(prior.body, {
      status: prior.status,
      headers: {
        ...privateNoStoreHeaders(),
        "Idempotency-Replayed": "true",
      },
    });
  }

  const res = await args.run();
  // Cache successful and domain-safe responses (2xx / 4xx that are stable).
  if (res.status < 500) {
    let parsed: unknown = null;
    try {
      parsed = await res.clone().json();
    } catch {
      parsed = null;
    }
    await storeSet(storageKey, {
      status: res.status,
      body: parsed,
      bodyHash,
    });
  }
  return res;
}
