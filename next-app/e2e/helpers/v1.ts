/**
 * Playwright helpers — fake V1 users/sessions via AuthService + DB cleanup.
 */

import { randomUUID } from "crypto";
import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";
import type { Page, BrowserContext } from "@playwright/test";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../../src/db/client";
import { users, familyMemberships, families } from "../../src/db/schema";
import { createSession, revokeSession } from "../../src/v1/services/authService";
import { V1_SESSION_COOKIE_NAME } from "../../src/v1/domain/auth/types";
import { isV1AuthConfigured } from "../../src/v1/domain/auth/config";
import { deleteMedia, finalizeClientUpload } from "../../src/v1/services/mediaService";
import { getObjectStorage } from "../../src/v1/storage/objectStorage";
import { mediaObjects } from "../../src/db/schema";
import { eq, and } from "drizzle-orm";
import type { MembershipRole } from "../../src/db/constants";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const trackedUserIds: string[] = [];
const trackedMediaIds: { familyId: string; mediaId: string; ownerId: string }[] =
  [];

export function requireV1Env() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    throw new Error("V1 DB / Auth not configured for E2E");
  }
}

export async function insertFakeUser(): Promise<string> {
  const db = getV1Db();
  const id = randomUUID();
  const now = new Date();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  trackedUserIds.push(id);
  return id;
}

export async function sessionTokenFor(userId: string): Promise<string> {
  const { sessionToken } = await createSession(userId);
  return sessionToken;
}

export async function applySessionCookie(
  context: BrowserContext,
  token: string,
  baseURL: string
) {
  const u = new URL(baseURL);
  await context.addCookies([
    {
      name: V1_SESSION_COOKIE_NAME,
      value: token,
      domain: u.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function loginAs(
  page: Page,
  userId: string,
  baseURL: string
): Promise<string> {
  const token = await sessionTokenFor(userId);
  await applySessionCookie(page.context(), token, baseURL);
  return token;
}

export async function revokeToken(token: string) {
  await revokeSession(token);
}

export async function insertMembership(
  familyId: string,
  userId: string,
  role: MembershipRole
) {
  const db = getV1Db();
  const now = new Date();
  await db.insert(familyMemberships).values({
    id: randomUUID(),
    familyId,
    userId,
    role,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
}

export function trackMedia(
  familyId: string,
  mediaId: string,
  ownerId: string
) {
  trackedMediaIds.push({ familyId, mediaId, ownerId });
}

/**
 * Local E2E: Vercel cannot callback localhost for onUploadCompleted.
 * After browser→Blob put, finalize PENDING_UPLOAD rows (same as webhook).
 * Waits until at least one media is finalized (or timeout).
 */
export async function finalizePendingUploadsForFamily(
  familyId: string,
  ownerId: string,
  opts?: { timeoutMs?: number }
): Promise<number> {
  const db = getV1Db();
  const storage = getObjectStorage();
  const deadline = Date.now() + (opts?.timeoutMs ?? 90_000);
  let finalized = 0;
  while (Date.now() < deadline) {
    const pending = await db
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.familyId, familyId),
          eq(mediaObjects.status, "PENDING_UPLOAD")
        )
      );
    for (const row of pending) {
      if (!row.storageKey) continue;
      try {
        const head = await storage.headObject(row.storageKey);
        if (!head) continue;
        await finalizeClientUpload(
          {
            mediaId: row.id,
            pathname: row.storageKey,
            contentType: row.mimeType || "application/octet-stream",
            actualByteSize: head.contentLength ?? row.byteSize ?? -1,
          },
          { db, storage }
        );
        trackMedia(familyId, row.id, ownerId);
        finalized += 1;
      } catch {
        /* retry */
      }
    }
    if (finalized > 0) return finalized;
    await new Promise((r) => setTimeout(r, 500));
  }
  return finalized;
}

async function countTable(table: string): Promise<number> {
  const db = getV1Db();
  const r = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS c FROM ${table}`)
  );
  const row = (r as unknown as { rows?: { c: number }[] }).rows?.[0];
  return row?.c ?? Number((r as unknown as { c: number }[])[0]?.c ?? 0);
}

export async function tableCounts(): Promise<Record<string, number>> {
  const names = [
    "users",
    "sessions",
    "families",
    "family_memberships",
    "persons",
    "relationships",
    "claims",
    "evidence",
    "claim_evidence",
    "media_objects",
    "family_versions",
    "audit_events",
    "alpha_invites",
  ];
  const out: Record<string, number> = {};
  for (const n of names) out[n] = await countTable(n);
  return out;
}

export async function cleanupAllV1TestData(): Promise<void> {
  const db = getV1Db();

  for (const m of trackedMediaIds) {
    try {
      await deleteMedia(
        m.mediaId,
        { kind: "USER", userId: m.ownerId },
        { db }
      );
    } catch {
      /* best effort */
    }
  }
  trackedMediaIds.length = 0;

  await db.execute(sql`DELETE FROM claim_evidence`);
  await db.execute(sql`DELETE FROM claims`);
  await db.execute(sql`DELETE FROM evidence`);
  await db.execute(sql`DELETE FROM relationships`);
  await db.execute(sql`DELETE FROM persons`);
  await db.execute(sql`DELETE FROM media_objects`);
  await db.execute(sql`DELETE FROM family_versions`);
  await db.execute(sql`DELETE FROM audit_events`);
  await db.execute(sql`DELETE FROM family_memberships`);
  await db.execute(sql`DELETE FROM family_share_links`).catch(() => undefined);
  await db.execute(sql`DELETE FROM families`);
  await db.execute(sql`DELETE FROM sessions`);
  await db.execute(sql`DELETE FROM auth_challenges`).catch(() => undefined);
  await db.execute(sql`DELETE FROM alpha_invites`).catch(() => undefined);
  await db.execute(sql`DELETE FROM users`);
  trackedUserIds.length = 0;
}

export async function closeDb() {
  await closeV1Db();
}

export async function apiJson(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown },
  baseURL?: string
) {
  let origin = baseURL?.replace(/\/$/, "");
  if (!origin) {
    const current = page.url();
    origin = current.startsWith("http")
      ? new URL(current).origin
      : "http://127.0.0.1:3010";
  }
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  return page.evaluate(
    async ({ url, init }) => {
      const res = await fetch(url, {
        method: init?.method ?? "GET",
        credentials: "include",
        headers:
          init?.body !== undefined
            ? { "Content-Type": "application/json" }
            : undefined,
        body:
          init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    },
    { url, init }
  );
}

export { families, getV1Db };
