/**
 * CF-V1-LOCAL-001 smoke — local Alpha operability helpers.
 * Never enables Production gates. Cleanup to 0.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import { users } from "../src/db/schema";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { createSession } from "../src/v1/services/authService";
import { createFamily } from "../src/v1/services/familyService";
import { reserveMediaUpload, finalizeLocalPendingMedia } from "../src/v1/services/mediaService";
import { MemoryObjectStorage } from "../src/v1/storage/memoryObjectStorage";
import { setObjectStorageForTests } from "../src/v1/storage/objectStorage";
import { isV1BlobLocalFinalizeEnabled } from "../src/v1/http/featureGate";
import { isConsoleOtpDeliveryEnabled } from "../src/v1/email/consoleOtpDeliveryAdapter";
import { createConsoleOtpDeliveryAdapter } from "../src/v1/email/consoleOtpDeliveryAdapter";
import { createResendOtpDeliveryAdapter } from "../src/v1/email/resendOtpDeliveryAdapter";
import { isResendConfigured } from "../src/v1/email/config";

config({ path: ".env.local" });
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

function ctx(userId: string) {
  return { kind: "USER" as const, userId };
}

async function main() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB / Auth not configured");
    process.exit(2);
  }

  // Gate fail-closed defaults (do not mutate caller's production intent permanently)
  const prevFinalize = process.env.V1_BLOB_LOCAL_FINALIZE;
  const prevOtp = process.env.V1_OTP_DELIVERY;
  delete process.env.V1_BLOB_LOCAL_FINALIZE;
  delete process.env.V1_OTP_DELIVERY;

  if (!isV1BlobLocalFinalizeEnabled()) pass("finalize_gate_default_off");
  else fail("finalize_gate_default_off", "expected false");

  if (!isConsoleOtpDeliveryEnabled()) pass("otp_console_default_off");
  else fail("otp_console_default_off", "expected false");

  process.env.V1_OTP_DELIVERY = "console";
  if (isConsoleOtpDeliveryEnabled()) pass("otp_console_opt_in");
  else fail("otp_console_opt_in", "expected true");

  const adapter = createConsoleOtpDeliveryAdapter();
  await adapter.deliver("test-zhao@example.com", "123456", {
    challengeId: randomUUID(),
  });
  pass("otp_console_deliver");

  // Resend fail-closed for human recipients when flag unset
  const prevSender = process.env.V1_AUTH_SENDER_VERIFIED;
  delete process.env.V1_AUTH_SENDER_VERIFIED;
  if (isResendConfigured()) {
    try {
      await createResendOtpDeliveryAdapter().deliver(
        "human-probe@example.com",
        "000000",
        { challengeId: randomUUID() }
      );
      fail("sender_domain_required", "expected throw for human recipient");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "SENDER_DOMAIN_REQUIRED") pass("sender_domain_required");
      else fail("sender_domain_required", msg);
    }
  } else {
    pass("sender_domain_required", "skipped (no RESEND_API_KEY)");
  }
  if (prevSender === undefined) delete process.env.V1_AUTH_SENDER_VERIFIED;
  else process.env.V1_AUTH_SENDER_VERIFIED = prevSender;

  process.env.V1_BLOB_LOCAL_FINALIZE = "true";
  if (isV1BlobLocalFinalizeEnabled()) pass("finalize_gate_opt_in");
  else fail("finalize_gate_opt_in", "expected true");

  const db = getV1Db();
  const storage = new MemoryObjectStorage();
  setObjectStorageForTests(storage);
  const ownerId = randomUUID();
  const now = new Date();

  try {
    await db.insert(users).values({ id: ownerId, createdAt: now, updatedAt: now });
    await createSession(ownerId);
    const fam = await createFamily(
      {
        ownerUserId: ownerId,
        displayName: "测试赵氏家庭",
        surname: "赵",
        visibility: "PRIVATE",
        discoveryEnabled: false,
      },
      { db }
    );

    const reserved = await reserveMediaUpload(
      {
        familyId: fam.family.id,
        actorContext: ctx(ownerId),
        mimeType: "image/png",
        byteSize: 8,
        visibility: "FAMILY",
        originalFilename: "t.png",
      },
      { db, storage }
    );

    // Object not present yet
    try {
      await finalizeLocalPendingMedia(
        fam.family.id,
        reserved.mediaId,
        ctx(ownerId),
        { db, storage }
      );
      fail("finalize_before_put", "should throw");
    } catch {
      pass("finalize_before_put", "UPLOAD_FAILED or equivalent");
    }

    const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    await storage.putObject({
      key: reserved.pathname,
      body,
      contentType: "image/png",
      contentLength: body.length,
    });

    const fin = await finalizeLocalPendingMedia(
      fam.family.id,
      reserved.mediaId,
      ctx(ownerId),
      { db, storage }
    );
    if (fin.status === "ACTIVE") pass("finalize_after_put");
    else fail("finalize_after_put", fin.status);

    const again = await finalizeLocalPendingMedia(
      fam.family.id,
      reserved.mediaId,
      ctx(ownerId),
      { db, storage }
    );
    if (again.status === "ALREADY_ACTIVE") pass("finalize_idempotent");
    else fail("finalize_idempotent", again.status);
  } finally {
    setObjectStorageForTests(null);
    await db.execute(sql`DELETE FROM media_objects`);
    await db.execute(sql`DELETE FROM family_versions`);
    await db.execute(sql`DELETE FROM audit_events`);
    await db.execute(sql`DELETE FROM family_memberships`);
    await db.execute(sql`DELETE FROM families`);
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM users`);
    await closeV1Db();

    if (prevFinalize === undefined) delete process.env.V1_BLOB_LOCAL_FINALIZE;
    else process.env.V1_BLOB_LOCAL_FINALIZE = prevFinalize;
    if (prevOtp === undefined) delete process.env.V1_OTP_DELIVERY;
    else process.env.V1_OTP_DELIVERY = prevOtp;
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
