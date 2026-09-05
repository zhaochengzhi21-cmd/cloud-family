/**
 * CF-V1-API-002 Media direct upload smoke.
 * - Domain + HTTP handlers (MemoryObjectStorage)
 * - Optional live 6MiB → Private Blob via client token (not CF Function body)
 * Never prints tokens, signed URLs, or credentials.
 */

import { config } from "dotenv";
import { randomUUID, randomBytes } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  sessions,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  mediaObjects,
  claims,
  evidence,
  claimEvidence,
  persons,
} from "../src/db/schema";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { createSession } from "../src/v1/services/authService";
import { V1_SESSION_COOKIE_NAME } from "../src/v1/domain/auth/types";
import { createFamily } from "../src/v1/services/familyService";
import { createPerson } from "../src/v1/services/personService";
import { createClaim, acceptClaim } from "../src/v1/services/claimService";
import {
  createEvidence,
  linkEvidenceToClaim,
  getEvidence,
} from "../src/v1/services/evidenceService";
import { getClaimWithEvidence } from "../src/v1/services/claimService";
import {
  authorizeClientUploadToken,
  cleanupStalePendingMedia,
  deleteMedia,
  finalizeClientUpload,
  getMediaReadAccess,
  getMediaUploadStatus,
  multipartRecommendedForSize,
  reserveMediaUpload,
} from "../src/v1/services/mediaService";
import { isMediaDomainError } from "../src/v1/domain/media/errors";
import {
  MEDIA_MULTIPART_THRESHOLD_BYTES,
  MEDIA_STALE_PENDING_MS,
  MEDIA_UPLOAD_INTENT_TTL_MS,
  buildOpaqueStorageKey,
} from "../src/v1/domain/media/types";
import { MemoryObjectStorage } from "../src/v1/storage/memoryObjectStorage";
import {
  getObjectStorage,
  setObjectStorageForTests,
} from "../src/v1/storage/objectStorage";
import {
  getV1ObjectStorageConfig,
  isV1ObjectStorageConfigured,
  resetV1ObjectStorageConfigCache,
} from "../src/v1/storage/config";
import { VercelBlobObjectStorage } from "../src/v1/storage/vercelBlobObjectStorage";
import { generateClientTokenFromReadWriteToken, put as clientPut } from "@vercel/blob/client";
import { isClaimDomainError } from "../src/v1/domain/claim/errors";
import { isEvidenceDomainError } from "../src/v1/domain/evidence/errors";

import * as familiesRoot from "../src/app/api/v1/families/route";
import * as uploadIntents from "../src/app/api/v1/families/[familyId]/media/upload-intents/route";
import * as mediaRoute from "../src/app/api/v1/families/[familyId]/media/[mediaId]/route";
import * as mediaStatus from "../src/app/api/v1/families/[familyId]/media/[mediaId]/status/route";
import * as clientUpload from "../src/app/api/v1/media/client-upload/route";
import * as claimsRoute from "../src/app/api/v1/families/[familyId]/claims/route";
import * as evidenceRoute from "../src/app/api/v1/families/[familyId]/evidence/route";
import * as claimEvRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/evidence/route";
import * as claimIdRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/route";
import fs from "fs";
import path from "path";

config({ path: ".env.local" });
config({ path: ".env.development.local" });
config({ path: ".env" });

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function pass(name: string, detail = "ok") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name} — ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}

const ORIGIN = "https://cloud-family.vercel.app";
const trackedUsers: string[] = [];
const blobKeys: string[] = [];

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  trackedUsers.push(id);
}

async function insertMember(
  db: ReturnType<typeof getV1Db>,
  familyId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"
) {
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

async function sessionCookie(userId: string) {
  const { sessionToken } = await createSession(userId);
  return `${V1_SESSION_COOKIE_NAME}=${sessionToken}`;
}

function ctx(userId: string) {
  return { kind: "USER" as const, userId };
}

function makeReq(
  method: string,
  url: string,
  opts: {
    cookie?: string;
    origin?: string | null;
    body?: unknown;
    contentType?: string;
  } = {}
) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin !== null && opts.origin !== undefined) {
    headers.set("origin", opts.origin);
  } else if (opts.origin === undefined && method !== "GET") {
    headers.set("origin", ORIGIN);
  }
  if (opts.body !== undefined) {
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function readJson(res: Response) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text, headers: res.headers };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function familyVersion(
  db: ReturnType<typeof getV1Db>,
  familyId: string
): Promise<number> {
  const [row] = await db
    .select({ v: families.currentVersionNo })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  return Number(row?.v ?? 0);
}

async function auditCount(
  db: ReturnType<typeof getV1Db>,
  familyId: string,
  eventType: string
) {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM audit_events
    WHERE family_id = ${familyId} AND event_type = ${eventType}
  `);
  return Number((r.rows[0] as { c: number }).c);
}

async function cleanup(db: ReturnType<typeof getV1Db>) {
  if (!trackedUsers.length) return;
  const famRows = await db
    .select({ id: families.id })
    .from(families)
    .where(inArray(families.createdByUserId, trackedUsers));
  const famIds = famRows.map((f) => f.id);
  for (const fid of famIds) {
    await db.execute(
      sql`DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE family_id = ${fid})`
    );
    await db.execute(sql`DELETE FROM claims WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM evidence WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM persons WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM media_objects WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM family_versions WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM audit_events WHERE family_id = ${fid}`);
    await db.execute(
      sql`DELETE FROM family_memberships WHERE family_id = ${fid}`
    );
    await db.execute(sql`DELETE FROM families WHERE id = ${fid}`);
  }
  await db.delete(sessions).where(inArray(sessions.userId, trackedUsers));
  await db.delete(users).where(inArray(users.id, trackedUsers));
}

async function countTable(db: ReturnType<typeof getV1Db>, table: string) {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${table}`));
  return Number((r.rows[0] as { c: number }).c);
}

function assertNoFileBodyApis() {
  const roots = [
    path.join("src", "app", "api", "v1", "families"),
    path.join("src", "app", "api", "v1", "media"),
  ];
  const bad = ["formData()", "arrayBuffer()", "request.blob("];
  let found = false;
  for (const root of roots) {
    const abs = path.join(process.cwd(), root);
    if (!fs.existsSync(abs)) continue;
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name.endsWith(".ts")) {
          const text = fs.readFileSync(p, "utf8");
          if (!p.includes(`${path.sep}media${path.sep}`)) continue;
          for (const b of bad) {
            if (text.includes(b)) {
              found = true;
              fail("no_function_file_body", `${p} contains ${b}`);
            }
          }
        }
      }
    };
    walk(abs);
  }
  if (!found) pass("no_function_file_body");
}

async function main() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB/Auth not configured");
    process.exit(2);
  }

  process.env.V1_ALLOWED_ORIGINS =
    "https://cloud-family.vercel.app,http://localhost:3000";
  process.env.V1_ALPHA_APP_ENABLED = "true";

  const mem = new MemoryObjectStorage();
  setObjectStorageForTests(mem);
  const db = getV1Db();

  try {
    assertNoFileBodyApis();

    // Gate off
    process.env.V1_ALPHA_APP_ENABLED = "false";
    {
      const ownerId = randomUUID();
      await insertUser(db, ownerId);
      const cookie = await sessionCookie(ownerId);
      const res = await readJson(
        await uploadIntents.POST(
          makeReq("POST", "/api/v1/families/x/media/upload-intents", {
            cookie,
            body: {
              mimeType: "image/jpeg",
              byteSize: 100,
            },
          }),
          { params: { familyId: randomUUID() } }
        )
      );
      if (res.status === 404) pass("feature_gate_media_off");
      else fail("feature_gate_media_off", `status=${res.status}`);
    }
    process.env.V1_ALPHA_APP_ENABLED = "true";

    const ownerId = randomUUID();
    const editorId = randomUUID();
    const viewerId = randomUUID();
    const otherId = randomUUID();
    await insertUser(db, ownerId);
    await insertUser(db, editorId);
    await insertUser(db, viewerId);
    await insertUser(db, otherId);

    const ownerCookie = await sessionCookie(ownerId);
    const editorCookie = await sessionCookie(editorId);
    const viewerCookie = await sessionCookie(viewerId);
    const otherCookie = await sessionCookie(otherId);

    const fam = await createFamily(
      { ownerUserId: ownerId, displayName: "Media Direct Smoke" },
      { db }
    );
    const familyId = fam.family.id;
    await insertMember(db, familyId, editorId, "EDITOR");
    await insertMember(db, familyId, viewerId, "VIEWER");
    const v0 = await familyVersion(db, familyId);

    // Reserve HTTP — no version bump
    {
      const res = await readJson(
        await uploadIntents.POST(
          makeReq("POST", `/api/v1/families/${familyId}/media/upload-intents`, {
            cookie: ownerCookie,
            body: {
              originalFilename: "scan.pdf",
              mimeType: "application/pdf",
              byteSize: 1024,
              visibility: "FAMILY",
              pathname: "evil",
              storageKey: "evil",
            },
          }),
          { params: { familyId } }
        )
      );
      if (res.status === 400) pass("reserve_mass_assignment_rejected");
      else fail("reserve_mass_assignment_rejected", `status=${res.status}`);

      const ok = await readJson(
        await uploadIntents.POST(
          makeReq("POST", `/api/v1/families/${familyId}/media/upload-intents`, {
            cookie: ownerCookie,
            body: {
              originalFilename: "scan.pdf",
              mimeType: "application/pdf",
              byteSize: 1024,
            },
          }),
          { params: { familyId } }
        )
      );
      const media = asObj(asObj(ok.body).media);
      const upload = asObj(asObj(ok.body).upload);
      const v1 = await familyVersion(db, familyId);
      if (
        ok.status === 201 &&
        media.status === "PENDING_UPLOAD" &&
        v1 === v0 &&
        (await auditCount(db, familyId, "MEDIA_CREATED")) === 0 &&
        typeof upload.pathname === "string" &&
        upload.handleUploadUrl === "/api/v1/media/client-upload"
      ) {
        pass("reserve_pending_no_version");
      } else {
        fail("reserve_pending_no_version", `status=${ok.status} v=${v1}`);
      }
    }

    // Viewer cannot reserve
    {
      const res = await readJson(
        await uploadIntents.POST(
          makeReq("POST", `/api/v1/families/${familyId}/media/upload-intents`, {
            cookie: viewerCookie,
            body: { mimeType: "image/jpeg", byteSize: 100 },
          }),
          { params: { familyId } }
        )
      );
      if (res.status === 403) pass("viewer_reserve_denied");
      else fail("viewer_reserve_denied", `status=${res.status}`);
    }

    // Dangerous MIME
    {
      const res = await readJson(
        await uploadIntents.POST(
          makeReq("POST", `/api/v1/families/${familyId}/media/upload-intents`, {
            cookie: ownerCookie,
            body: { mimeType: "text/html", byteSize: 100 },
          }),
          { params: { familyId } }
        )
      );
      if (res.status === 400) pass("dangerous_mime_rejected");
      else fail("dangerous_mime_rejected", `status=${res.status}`);
    }

    // Domain finalize happy path (memory)
    let activeMediaId = "";
    {
      const reserved = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 64,
          visibility: "FAMILY",
        },
        { db, storage: mem }
      );
      const body = randomBytes(64);
      await mem.putObject({
        key: reserved.pathname,
        body,
        contentType: "image/jpeg",
        contentLength: 64,
      });
      blobKeys.push(reserved.pathname);
      const before = await familyVersion(db, familyId);
      const auditsBefore = await auditCount(db, familyId, "MEDIA_CREATED");
      const fin = await finalizeClientUpload(
        {
          mediaId: reserved.mediaId,
          pathname: reserved.pathname,
          contentType: "image/jpeg",
          actualByteSize: 64,
        },
        { db, storage: mem }
      );
      const after = await familyVersion(db, familyId);
      const auditsAfter = await auditCount(db, familyId, "MEDIA_CREATED");
      if (
        fin.status === "ACTIVE" &&
        after === before + 1 &&
        auditsAfter === auditsBefore + 1
      ) {
        pass("finalize_active");
        activeMediaId = reserved.mediaId;
      } else {
        fail("finalize_active", `fin=${fin.status}`);
      }

      // Idempotent retry
      const fin2 = await finalizeClientUpload(
        {
          mediaId: reserved.mediaId,
          pathname: reserved.pathname,
          contentType: "image/jpeg",
          actualByteSize: 64,
        },
        { db, storage: mem }
      );
      const after2 = await familyVersion(db, familyId);
      const audits2 = await auditCount(db, familyId, "MEDIA_CREATED");
      if (
        fin2.status === "ALREADY_ACTIVE" &&
        after2 === after &&
        audits2 === auditsAfter
      ) {
        pass("finalize_idempotent");
      } else {
        fail("finalize_idempotent", `status=${fin2.status}`);
      }

      // Concurrent finalize
      const r2 = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/png",
          byteSize: 32,
        },
        { db, storage: mem }
      );
      await mem.putObject({
        key: r2.pathname,
        body: randomBytes(32),
        contentType: "image/png",
        contentLength: 32,
      });
      const vb = await familyVersion(db, familyId);
      const ab = await auditCount(db, familyId, "MEDIA_CREATED");
      const [a, b] = await Promise.all([
        finalizeClientUpload(
          {
            mediaId: r2.mediaId,
            pathname: r2.pathname,
            contentType: "image/png",
            actualByteSize: 32,
          },
          { db, storage: mem }
        ),
        finalizeClientUpload(
          {
            mediaId: r2.mediaId,
            pathname: r2.pathname,
            contentType: "image/png",
            actualByteSize: 32,
          },
          { db, storage: mem }
        ),
      ]);
      const va = await familyVersion(db, familyId);
      const aa = await auditCount(db, familyId, "MEDIA_CREATED");
      const statuses = [a.status, b.status].sort();
      if (
        va === vb + 1 &&
        aa === ab + 1 &&
        statuses.includes("ACTIVE") &&
        (statuses.includes("ALREADY_ACTIVE") || statuses[0] === statuses[1])
      ) {
        pass("finalize_concurrent");
      } else {
        fail(
          "finalize_concurrent",
          `v=${vb}→${va} audits=${ab}→${aa} s=${a.status},${b.status}`
        );
      }
    }

    // Size / MIME / path mismatch
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 1000,
        },
        { db, storage: mem }
      );
      await mem.putObject({
        key: r.pathname,
        body: randomBytes(999),
        contentType: "image/jpeg",
        contentLength: 999,
      });
      const vb = await familyVersion(db, familyId);
      const fin = await finalizeClientUpload(
        {
          mediaId: r.mediaId,
          pathname: r.pathname,
          contentType: "image/jpeg",
          actualByteSize: 999,
        },
        { db, storage: mem }
      );
      const va = await familyVersion(db, familyId);
      if (fin.status === "FAILED" && va === vb) pass("size_mismatch_cleaned");
      else fail("size_mismatch_cleaned", `status=${fin.status}`);
    }
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 50,
        },
        { db, storage: mem }
      );
      await mem.putObject({
        key: r.pathname,
        body: randomBytes(50),
        contentType: "image/png",
        contentLength: 50,
      });
      const fin = await finalizeClientUpload(
        {
          mediaId: r.mediaId,
          pathname: r.pathname,
          contentType: "image/png",
          actualByteSize: 50,
        },
        { db, storage: mem }
      );
      if (fin.status === "FAILED") pass("mime_mismatch_cleaned");
      else fail("mime_mismatch_cleaned", `status=${fin.status}`);
    }
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 40,
        },
        { db, storage: mem }
      );
      const wrong = `families/${familyId}/media/${randomUUID()}/original`;
      await mem.putObject({
        key: wrong,
        body: randomBytes(40),
        contentType: "image/jpeg",
        contentLength: 40,
      });
      const fin = await finalizeClientUpload(
        {
          mediaId: r.mediaId,
          pathname: wrong,
          contentType: "image/jpeg",
          actualByteSize: 40,
        },
        { db, storage: mem }
      );
      if (fin.status === "FAILED") pass("path_mismatch_cleaned");
      else fail("path_mismatch_cleaned", `status=${fin.status}`);
    }

    // Token authorization
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 20,
        },
        { db, storage: mem }
      );
      try {
        await authorizeClientUploadToken(
          {
            mediaId: r.mediaId,
            requestedPathname: r.pathname,
            actorContext: ctx(otherId),
          },
          { db }
        );
        fail("other_user_token", "should deny");
      } catch (e) {
        if (isMediaDomainError(e)) pass("other_user_token");
        else fail("other_user_token", String(e));
      }
      try {
        await authorizeClientUploadToken(
          {
            mediaId: r.mediaId,
            requestedPathname: `families/${randomUUID()}/media/${r.mediaId}/original`,
            actorContext: ctx(ownerId),
          },
          { db }
        );
        fail("arbitrary_path_token", "should deny");
      } catch (e) {
        if (isMediaDomainError(e)) pass("arbitrary_path_token");
        else fail("arbitrary_path_token", String(e));
      }
      const ok = await authorizeClientUploadToken(
        {
          mediaId: r.mediaId,
          requestedPathname: r.pathname,
          actorContext: ctx(ownerId),
        },
        { db }
      );
      if (
        ok.allowOverwrite === false &&
        ok.addRandomSuffix === false &&
        ok.maximumSizeInBytes === 20 &&
        ok.allowedContentTypes[0] === "image/jpeg" &&
        ok.validUntil <= Date.now() + 5 * 60 * 1000 + 1000
      ) {
        pass("token_constraints");
      } else fail("token_constraints", "constraint mismatch");

      // Expired intent
      try {
        await authorizeClientUploadToken(
          {
            mediaId: r.mediaId,
            requestedPathname: r.pathname,
            actorContext: ctx(ownerId),
            now: new Date(Date.now() + MEDIA_UPLOAD_INTENT_TTL_MS + 1000),
          },
          { db }
        );
        fail("expired_intent", "should deny");
      } catch (e) {
        if (isMediaDomainError(e) && e.code === "INVALID_INPUT") {
          pass("expired_intent");
        } else fail("expired_intent", String(e));
      }
    }

    // Client-upload HTTP token gate + origin
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 10,
        },
        { db, storage: mem }
      );
      const evil = await readJson(
        await clientUpload.POST(
          makeReq("POST", "/api/v1/media/client-upload", {
            cookie: ownerCookie,
            origin: "https://evil.example",
            body: {
              type: "blob.generate-client-token",
              payload: {
                pathname: r.pathname,
                multipart: false,
                clientPayload: JSON.stringify({ mediaId: r.mediaId }),
              },
            },
          })
        )
      );
      if (evil.status === 403) pass("token_evil_origin");
      else fail("token_evil_origin", `status=${evil.status}`);

      process.env.V1_ALPHA_APP_ENABLED = "false";
      const gated = await readJson(
        await clientUpload.POST(
          makeReq("POST", "/api/v1/media/client-upload", {
            cookie: ownerCookie,
            body: {
              type: "blob.generate-client-token",
              payload: {
                pathname: r.pathname,
                multipart: false,
                clientPayload: JSON.stringify({ mediaId: r.mediaId }),
              },
            },
          })
        )
      );
      process.env.V1_ALPHA_APP_ENABLED = "true";
      if (gated.status === 404) pass("token_gate_off");
      else fail("token_gate_off", `status=${gated.status}`);
    }

    // Stale cleanup
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 8,
        },
        { db, storage: mem }
      );
      await db
        .update(mediaObjects)
        .set({
          createdAt: new Date(Date.now() - MEDIA_STALE_PENDING_MS - 1000),
        })
        .where(eq(mediaObjects.id, r.mediaId));
      const vb = await familyVersion(db, familyId);
      const cleaned = await cleanupStalePendingMedia({
        db,
        storage: mem,
        olderThanMs: MEDIA_STALE_PENDING_MS,
      });
      const row = await db
        .select({ status: mediaObjects.status })
        .from(mediaObjects)
        .where(eq(mediaObjects.id, r.mediaId))
        .limit(1);
      const va = await familyVersion(db, familyId);
      if (
        cleaned.cleaned >= 1 &&
        row[0]?.status === "FAILED" &&
        va === vb
      ) {
        pass("stale_pending_cleanup");
      } else {
        fail("stale_pending_cleanup", `status=${row[0]?.status}`);
      }
    }

    // Status / read / privacy HTTP
    {
      const st = await readJson(
        await mediaStatus.GET(
          makeReq("GET", `/api/v1/families/${familyId}/media/${activeMediaId}/status`, {
            cookie: ownerCookie,
          }),
          { params: { familyId, mediaId: activeMediaId } }
        )
      );
      if (
        st.status === 200 &&
        asObj(st.body).status === "ACTIVE" &&
        !st.text.includes("storage_key") &&
        !st.text.includes("storageKey")
      ) {
        pass("media_status_http");
      } else fail("media_status_http", `status=${st.status}`);

      const viewerSt = await readJson(
        await mediaStatus.GET(
          makeReq("GET", `/api/v1/families/${familyId}/media/${activeMediaId}/status`, {
            cookie: viewerCookie,
          }),
          { params: { familyId, mediaId: activeMediaId } }
        )
      );
      if (viewerSt.status === 403 || viewerSt.status === 404) {
        pass("viewer_status_denied");
      } else fail("viewer_status_denied", `status=${viewerSt.status}`);

      const read = await readJson(
        await mediaRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/media/${activeMediaId}`, {
            cookie: ownerCookie,
          }),
          { params: { familyId, mediaId: activeMediaId } }
        )
      );
      const cc = read.headers.get("Cache-Control");
      if (
        read.status === 200 &&
        cc === "private, no-store" &&
        asObj(asObj(read.body).read).url
      ) {
        pass("media_read_signed");
      } else fail("media_read_signed", `status=${read.status}`);

      const unrel = await readJson(
        await mediaRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/media/${activeMediaId}`, {
            cookie: otherCookie,
          }),
          { params: { familyId, mediaId: activeMediaId } }
        )
      );
      if (unrel.status === 404) pass("unrelated_media_404");
      else fail("unrelated_media_404", `status=${unrel.status}`);
    }

    // PRIVATE media EDITOR 404
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 16,
          visibility: "PRIVATE",
        },
        { db, storage: mem }
      );
      await mem.putObject({
        key: r.pathname,
        body: randomBytes(16),
        contentType: "image/jpeg",
        contentLength: 16,
      });
      await finalizeClientUpload(
        {
          mediaId: r.mediaId,
          pathname: r.pathname,
          contentType: "image/jpeg",
          actualByteSize: 16,
        },
        { db, storage: mem }
      );
      const ed = await readJson(
        await mediaRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/media/${r.mediaId}`, {
            cookie: editorCookie,
          }),
          { params: { familyId, mediaId: r.mediaId } }
        )
      );
      if (ed.status === 404) pass("private_media_editor_404");
      else fail("private_media_editor_404", `status=${ed.status}`);
    }

    // Evidence integration — ACTIVE only; no signed URL in claim bundle
    {
      const person = await createPerson(
        {
          familyId,
          actorContext: ctx(ownerId),
          preferredName: "MediaPerson",
        },
        { db }
      );
      const claim = await createClaim(
        {
          familyId,
          actorContext: ctx(ownerId),
          subjectType: "PERSON",
          subjectId: person.person.id,
          claimType: "ALIAS",
          value: { text: "媒" },
          originType: "MANUAL",
        },
        { db }
      );

      // PENDING cannot bind
      const pending = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 12,
        },
        { db, storage: mem }
      );
      try {
        await createEvidence(
          {
            familyId,
            actorContext: ctx(ownerId),
            evidenceType: "PHOTO",
            mediaObjectId: pending.mediaId,
            visibility: "FAMILY",
          },
          { db }
        );
        fail("pending_media_evidence", "should block");
      } catch (e) {
        if (isEvidenceDomainError(e)) pass("pending_media_evidence");
        else fail("pending_media_evidence", String(e));
      }

      const ev = await createEvidence(
        {
          familyId,
          actorContext: ctx(ownerId),
          evidenceType: "PHOTO",
          title: "photo",
          mediaObjectId: activeMediaId,
          visibility: "FAMILY",
        },
        { db }
      );
      await linkEvidenceToClaim(
        {
          familyId,
          actorContext: ctx(ownerId),
          claimId: claim.claim.id,
          evidenceId: ev.evidence.id,
          relation: "SUPPORTS",
        },
        { db }
      );
      const bundle = await getClaimWithEvidence(
        claim.claim.id,
        ctx(ownerId),
        { db }
      );
      const blob = JSON.stringify(bundle);
      if (
        bundle &&
        bundle.evidenceLinks.length >= 1 &&
        !blob.includes("signedUrl") &&
        !blob.includes("http")
      ) {
        pass("evidence_media_integration");
      } else {
        fail("evidence_media_integration", "bundle leak or missing");
      }
    }

    // PENDING delete no version
    {
      const r = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: 5,
        },
        { db, storage: mem }
      );
      const vb = await familyVersion(db, familyId);
      const del = await deleteMedia(r.mediaId, ctx(ownerId), {
        db,
        storage: mem,
        expectedFamilyId: familyId,
      });
      const va = await familyVersion(db, familyId);
      if (del.familyVersion == null && va === vb && del.status === "FAILED") {
        pass("pending_cancel_no_version");
      } else {
        fail("pending_cancel_no_version", `v=${vb}→${va}`);
      }
    }

    if (!multipartRecommendedForSize(MEDIA_MULTIPART_THRESHOLD_BYTES + 1)) {
      fail("multipart_threshold", "expected true");
    } else {
      pass("multipart_threshold");
    }

    // —— Live 6MiB direct to Private Blob (client token; not CF Function body) ——
    resetV1ObjectStorageConfigCache();
    setObjectStorageForTests(null);
    if (
      isV1ObjectStorageConfigured() &&
      getV1ObjectStorageConfig().provider === "VERCEL_BLOB" &&
      process.env.BLOB_READ_WRITE_TOKEN
    ) {
      const storage = new VercelBlobObjectStorage();
      setObjectStorageForTests(storage);
      const size = 6 * 1024 * 1024;
      const buf = randomBytes(size);
      // JPEG-ish header so content-type is image/jpeg; body is synthetic
      buf[0] = 0xff;
      buf[1] = 0xd8;
      const reserved = await reserveMediaUpload(
        {
          familyId,
          actorContext: ctx(ownerId),
          mimeType: "image/jpeg",
          byteSize: size,
          visibility: "FAMILY",
          originalFilename: "synthetic-6mib.jpg",
        },
        { db, storage }
      );
      blobKeys.push(reserved.pathname);
      const constraints = await authorizeClientUploadToken(
        {
          mediaId: reserved.mediaId,
          requestedPathname: reserved.pathname,
          actorContext: ctx(ownerId),
        },
        { db }
      );
      const clientToken = await generateClientTokenFromReadWriteToken({
        pathname: constraints.pathname,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowedContentTypes: constraints.allowedContentTypes,
        maximumSizeInBytes: constraints.maximumSizeInBytes,
        validUntil: constraints.validUntil,
        allowOverwrite: false,
        addRandomSuffix: false,
      });
      await clientPut(reserved.pathname, buf, {
        access: "private",
        token: clientToken,
        contentType: "image/jpeg",
        multipart: false,
      });
      const head = await storage.headObject(reserved.pathname);
      const vb = await familyVersion(db, familyId);
      const fin = await finalizeClientUpload(
        {
          mediaId: reserved.mediaId,
          pathname: reserved.pathname,
          contentType: "image/jpeg",
          actualByteSize: head?.contentLength ?? -1,
        },
        { db, storage }
      );
      const va = await familyVersion(db, familyId);
      if (
        fin.status === "ACTIVE" &&
        head?.contentLength === size &&
        va === vb + 1 &&
        size > 4.5 * 1024 * 1024
      ) {
        pass("6mb_direct_live_upload", `${size} bytes`);
      } else {
        fail(
          "6mb_direct_live_upload",
          `fin=${fin.status} head=${head?.contentLength}`
        );
      }

      // Read + delete cleanup
      const access = await getMediaReadAccess(reserved.mediaId, ctx(ownerId), {
        db,
        storage,
        expectedFamilyId: familyId,
      });
      if (access.signedUrl && access.expiresAt.getTime() <= Date.now() + 60_000 + 2000) {
        pass("6mb_signed_read");
      } else fail("6mb_signed_read", "ttl/url");

      await deleteMedia(reserved.mediaId, ctx(ownerId), {
        db,
        storage,
        expectedFamilyId: familyId,
      });
      const still = await storage.exists(reserved.pathname);
      if (!still) pass("6mb_blob_deleted");
      else fail("6mb_blob_deleted", "object remains");
    } else {
      fail("6mb_direct_live_upload", "VERCEL_BLOB / BLOB_READ_WRITE_TOKEN missing");
    }

    // Cleanup DB
    await cleanup(db);
    // Best-effort leftover blobs
    setObjectStorageForTests(null);
    if (isV1ObjectStorageConfigured()) {
      try {
        const storage = getObjectStorage();
        for (const k of blobKeys) {
          try {
            await storage.deleteObject(k);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }

    const tables = [
      "users",
      "sessions",
      "families",
      "family_memberships",
      "media_objects",
      "claims",
      "evidence",
      "claim_evidence",
      "family_versions",
      "audit_events",
      "persons",
    ];
    let clean = true;
    for (const t of tables) {
      const c = await countTable(db, t);
      if (c !== 0) {
        clean = false;
        fail("cleanup", `${t}=${c}`);
      }
    }
    if (clean) pass("cleanup");

    process.env.V1_ALPHA_APP_ENABLED = "false";
  } catch (e) {
    console.error(e);
    fail("fatal", e instanceof Error ? e.message : String(e));
    try {
      await cleanup(db);
    } catch {
      /* ignore */
    }
  } finally {
    setObjectStorageForTests(null);
    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n—— Summary ——");
  console.log(`PASS ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main();
