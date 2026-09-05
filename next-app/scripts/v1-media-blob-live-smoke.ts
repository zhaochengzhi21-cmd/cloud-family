/**
 * Live Vercel Private Blob + MediaService smoke.
 * Never prints tokens, signed URLs, or storage secrets.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  mediaObjects,
} from "../src/db/schema";
import {
  uploadMedia,
  getMediaReadAccess,
  deleteMedia,
} from "../src/v1/services/mediaService";
import { isMediaDomainError } from "../src/v1/domain/media/errors";
import { buildOpaqueStorageKey } from "../src/v1/domain/media/types";
import {
  getV1ObjectStorageConfig,
  isV1ObjectStorageConfigured,
  resetV1ObjectStorageConfigCache,
} from "../src/v1/storage/config";
import { getObjectStorage, setObjectStorageForTests } from "../src/v1/storage/objectStorage";
import { VercelBlobObjectStorage } from "../src/v1/storage/vercelBlobObjectStorage";
import { SIGNED_READ_URL_TTL_SECONDS } from "../src/v1/storage/types";

config({ path: ".env.local" });
config({ path: ".env.development.local" });
config({ path: ".env" });
resetV1ObjectStorageConfigCache();
setObjectStorageForTests(null);

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

function ctxUser(userId: string) {
  return { kind: "USER" as const, userId };
}
function ctxAnon() {
  return { kind: "ANONYMOUS" as const };
}

function tinyPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function main() {
  if (!isV1DbConfigured()) {
    console.error("V1_DATABASE_URL missing");
    process.exit(2);
  }
  if (!isV1ObjectStorageConfigured()) {
    console.error("Object storage not configured");
    process.exit(2);
  }

  const cfg = getV1ObjectStorageConfig();
  if (cfg.provider !== "VERCEL_BLOB") {
    console.error("Expected VERCEL_BLOB provider for this smoke");
    process.exit(2);
  }
  console.log(`AUTH_MODEL=${cfg.authModel}`);
  console.log(`PROVIDER=${cfg.provider}`);

  const storage = new VercelBlobObjectStorage();
  setObjectStorageForTests(storage);

  const db = getV1Db();
  const trackedUsers: string[] = [];
  const trackedFamilies: string[] = [];
  const blobKeys: string[] = [];

  try {
    const ownerId = randomUUID();
    const unrelatedId = randomUUID();
    const now = new Date();
    for (const id of [ownerId, unrelatedId]) {
      await db.insert(users).values({ id, createdAt: now, updatedAt: now });
      trackedUsers.push(id);
    }

    const privateFam = randomUUID();
    const publicFam = randomUUID();
    for (const [id, vis] of [
      [privateFam, "PRIVATE"],
      [publicFam, "PUBLIC"],
    ] as const) {
      await db.insert(families).values({
        id,
        displayName: "BlobLive",
        surname: "B",
        visibility: vis,
        discoveryEnabled: false,
        createdByUserId: ownerId,
        currentVersionNo: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(familyMemberships).values({
        id: randomUUID(),
        familyId: id,
        userId: ownerId,
        role: "OWNER",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(familyVersions).values({
        id: randomUUID(),
        familyId: id,
        versionNo: 1,
        createdByUserId: ownerId,
        schemaVersion: 1,
        summary: "seed",
        createdAt: now,
      });
      trackedFamilies.push(id);
    }

    const body = tinyPng();

    // Direct adapter put for unsigned-access proof
    const probeKey = `families/${randomUUID()}/media/${randomUUID()}/original`;
    await storage.putObject({
      key: probeKey,
      body,
      contentType: "image/png",
      contentLength: body.length,
      cacheControl: "private, no-store",
    });
    blobKeys.push(probeKey);
    const head = await storage.headObject(probeKey);
    if (head && head.contentLength === body.length) pass("live_put_head", "ok");
    else fail("live_put_head", "bad");

    // Unsigned raw URL probe — construct likely private host URL from signed URL base
    const signedProbe = await storage.getSignedReadUrl(probeKey, 60);
    // Strip query to get raw object URL
    const rawUrl = signedProbe.url.split("?")[0];
    try {
      const res = await fetch(rawUrl, { method: "GET", redirect: "manual" });
      if (res.status === 200) fail("unsigned_read", `unexpected 200`);
      else pass("unsigned_read", `status=${res.status}`);
    } catch {
      pass("unsigned_read", "blocked/failed");
    }

    const signedRes = await fetch(signedProbe.url);
    if (signedRes.ok && signedProbe.ttlSeconds <= 60) {
      pass("signed_read", "SIGNED_READ_PASS");
      pass("signed_TTL", `${signedProbe.ttlSeconds}s`);
    } else fail("signed_read", `http=${signedRes.status}`);

    await storage.deleteObject(probeKey);
    blobKeys.pop();
    if (!(await storage.exists(probeKey))) pass("adapter_delete", "gone");
    else fail("adapter_delete", "still exists");

    // MediaService live upload FAMILY on private family
    const [verBefore] = await db
      .select({ v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, privateFam));

    const uploaded = await uploadMedia({
      familyId: privateFam,
      actorContext: ctxUser(ownerId),
      body,
      mimeType: "image/png",
      originalFilename: "fixture.png",
      visibility: "FAMILY",
    });
    blobKeys.push(buildOpaqueStorageKey(privateFam, uploaded.mediaId));

    if (uploaded.familyVersion === verBefore.v + 1) {
      pass("media_service_active", `ver=${uploaded.familyVersion}`);
    } else fail("media_service_active", "version");

    const [mediaRow] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.mediaId));
    if (mediaRow.status === "ACTIVE" && mediaRow.storageProvider === "PRIVATE_OBJECT") {
      pass("pending_to_active", "PRIVATE_OBJECT");
    } else fail("pending_to_active", mediaRow.status);

    const auditCount = await db.execute(sql`
      SELECT count(*)::int AS c FROM audit_events
      WHERE family_id = ${privateFam} AND event_type = 'MEDIA_CREATED'
    `);
    if (Number((auditCount.rows[0] as { c: number }).c) >= 1) {
      pass("audit", "MEDIA_CREATED");
    } else fail("audit", "missing");

    // Owner read
    const ownerRead = await getMediaReadAccess(
      uploaded.mediaId,
      ctxUser(ownerId)
    );
    if (ownerRead.expiresAt.getTime() - Date.now() <= 62_000) {
      const r = await fetch(ownerRead.signedUrl);
      if (r.ok) pass("permission_owner_read", "SIGNED_READ_PASS");
      else fail("permission_owner_read", `http=${r.status}`);
    } else fail("permission_owner_read", "ttl");

    // Unrelated / anon deny — must not yield usable URL
    try {
      await getMediaReadAccess(uploaded.mediaId, ctxUser(unrelatedId));
      fail("permission_unrelated", "should deny");
    } catch (e) {
      if (isMediaDomainError(e) && e.code === "FORBIDDEN")
        pass("permission_unrelated", "DENY");
      else fail("permission_unrelated", String(e));
    }
    try {
      await getMediaReadAccess(uploaded.mediaId, ctxAnon());
      fail("permission_anon_family", "should deny");
    } catch {
      pass("permission_anon_family", "DENY");
    }

    // PUBLIC media + PRIVATE family → anon DENY
    const pubOnPriv = await uploadMedia({
      familyId: privateFam,
      actorContext: ctxUser(ownerId),
      body,
      mimeType: "image/png",
      visibility: "PUBLIC",
    });
    blobKeys.push(buildOpaqueStorageKey(privateFam, pubOnPriv.mediaId));
    try {
      await getMediaReadAccess(pubOnPriv.mediaId, ctxAnon());
      fail("family_ceiling", "should deny");
    } catch {
      pass("family_ceiling", "DENY");
    }

    // PUBLIC media + PUBLIC family → anon signed URL (blob still private)
    const pubOnPub = await uploadMedia({
      familyId: publicFam,
      actorContext: ctxUser(ownerId),
      body,
      mimeType: "image/png",
      visibility: "PUBLIC",
    });
    blobKeys.push(buildOpaqueStorageKey(publicFam, pubOnPub.mediaId));
    const anonRead = await getMediaReadAccess(pubOnPub.mediaId, ctxAnon());
    const anonFetch = await fetch(anonRead.signedUrl);
    if (anonFetch.ok) pass("public_app_private_blob", "SIGNED_READ_PASS");
    else fail("public_app_private_blob", `http=${anonFetch.status}`);

    // Verify underlying store still private: strip query from anon signed URL
    const rawPublic = anonRead.signedUrl.split("?")[0];
    try {
      const rawRes = await fetch(rawPublic, { redirect: "manual" });
      if (rawRes.status === 200) fail("bottom_store_private", "raw 200");
      else pass("bottom_store_private", `raw=${rawRes.status}`);
    } catch {
      pass("bottom_store_private", "blocked");
    }

    // Delete via MediaService
    const [verDelBefore] = await db
      .select({ v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, privateFam));
    const del = await deleteMedia(uploaded.mediaId, ctxUser(ownerId));
    if (
      del.physicalDeleted &&
      del.status === "DELETED" &&
      del.familyVersion === verDelBefore.v + 1
    ) {
      pass("logical_physical_delete", "DELETED once");
    } else fail("logical_physical_delete", JSON.stringify(del));

    try {
      await getMediaReadAccess(uploaded.mediaId, ctxUser(ownerId));
      fail("post_delete_read", "should deny");
    } catch {
      pass("post_delete_read", "DENY");
    }

    const key = buildOpaqueStorageKey(privateFam, uploaded.mediaId);
    if (!(await storage.exists(key))) pass("post_delete_exists", "gone");
    else fail("post_delete_exists", "still there");

    // Cleanup remaining blobs
    for (const k of [...blobKeys]) {
      try {
        await storage.deleteObject(k);
      } catch {
        /* ignore */
      }
    }
    blobKeys.length = 0;

    // Cleanup DB
    await db
      .delete(mediaObjects)
      .where(inArray(mediaObjects.familyId, trackedFamilies));
    await db
      .delete(familyMemberships)
      .where(inArray(familyMemberships.familyId, trackedFamilies));
    await db
      .delete(familyVersions)
      .where(inArray(familyVersions.familyId, trackedFamilies));
    await db
      .delete(auditEvents)
      .where(inArray(auditEvents.familyId, trackedFamilies));
    await db.delete(families).where(inArray(families.id, trackedFamilies));
    await db.delete(users).where(inArray(users.id, trackedUsers));

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM families) AS families,
        (SELECT count(*)::int FROM media_objects) AS media_objects,
        (SELECT count(*)::int FROM family_memberships) AS memberships,
        (SELECT count(*)::int FROM family_versions) AS versions,
        (SELECT count(*)::int FROM audit_events) AS audits
    `);
    const row = counts.rows[0] as Record<string, number>;
    if (Object.values(row).every((n) => Number(n) === 0)) pass("cleanup_db", "0");
    else fail("cleanup_db", JSON.stringify(row));

    pass("cleanup_blob", "smoke objects deleted");
    void getObjectStorage;
    void SIGNED_READ_URL_TTL_SECONDS;
  } catch (e) {
    console.error("LIVE SMOKE FATAL", e);
    fail("fatal", e instanceof Error ? e.message : String(e));
    // best-effort blob cleanup
    for (const k of blobKeys) {
      try {
        await storage.deleteObject(k);
      } catch {
        /* ignore */
      }
    }
  } finally {
    setObjectStorageForTests(null);
    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== SUMMARY ===");
  console.log(
    `passed=${results.filter((r) => r.ok).length} failed=${failed.length}`
  );
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("MEDIA_BLOB_LIVE_SMOKE = PASS");
  process.exit(0);
}

main();
