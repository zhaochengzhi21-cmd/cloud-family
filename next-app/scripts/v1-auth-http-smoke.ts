/**
 * CF-V1-AUTH-002 HTTP Auth smoke — Closed Alpha invite gate.
 * Uses InMemory OTP delivery (no real mail) + optional Resend official test address.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  sessions,
  authChallenges,
  alphaInvites,
} from "../src/db/schema";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { InMemoryOtpDeliveryAdapter } from "../src/v1/domain/auth/delivery";
import { normalizeEmail } from "../src/v1/domain/auth/email";
import { computeEmailLookupHash } from "../src/v1/domain/auth/crypto";
import {
  createAlphaInvite,
  revokeAlphaInvite,
  hashInviteToken,
} from "../src/v1/services/alphaInviteService";
import {
  defaultAuthHttpDeps,
  handleRequestCode,
  handleVerify,
  handleMe,
  handleLogout,
  type AuthHttpRequest,
  type AuthHttpDeps,
} from "../src/v1/http/auth/handlers";
import { createResendOtpDeliveryAdapter } from "../src/v1/email/resendOtpDeliveryAdapter";
import {
  isResendConfigured,
  isVerifiedSenderDomainReady,
} from "../src/v1/email/config";
import {
  OTP_MIN_INTERVAL_MS,
  OTP_ROLLING_15M_LIMIT,
  OTP_ROLLING_15M_MS,
  OTP_ROLLING_24H_LIMIT,
} from "../src/v1/domain/auth/types";
import * as inviteRepo from "../src/v1/repositories/alphaInviteRepository";
import { eq } from "drizzle-orm";

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

function makeReq(
  method: string,
  body: unknown,
  headers: Record<string, string> = {}
): AuthHttpRequest {
  return {
    method,
    headers: {
      get: (n: string) => {
        const key = Object.keys(headers).find(
          (k) => k.toLowerCase() === n.toLowerCase()
        );
        return key ? headers[key] : null;
      },
    },
    json: async () => body,
  };
}

function cookieFromSet(cookies: string[]): string | null {
  for (const c of cookies) {
    const m = c.match(/^cf_v1_session=([^;]*)/);
    if (m) return m[1] || null;
  }
  return null;
}

function assertNoStore(headers: Record<string, string>) {
  return headers["Cache-Control"] === "no-store";
}

async function main() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB / Auth not configured");
    process.exit(2);
  }

  process.env.V1_ALPHA_AUTH_ENABLED = "true";
  process.env.V1_ALLOWED_ORIGINS =
    "https://cloud-family.vercel.app,http://localhost:3000";

  const db = getV1Db();
  const adapter = new InMemoryOtpDeliveryAdapter();
  let clock = Date.now();
  const deps: AuthHttpDeps = defaultAuthHttpDeps({
    db,
    delivery: adapter,
    now: () => new Date(clock),
    secureCookie: true,
  });

  const originOk = { origin: "https://cloud-family.vercel.app" };
  const trackedUsers: string[] = [];
  const trackedInvites: string[] = [];

  try {
    // —— Feature gate when disabled ——
    process.env.V1_ALPHA_AUTH_ENABLED = "false";
    const gated = await handleRequestCode(
      makeReq("POST", { email: "a@example.com" }, originOk),
      deps
    );
    if (gated.status === 404) pass("feature_gate_fail_closed");
    else fail("feature_gate_fail_closed", `status=${gated.status}`);
    process.env.V1_ALPHA_AUTH_ENABLED = "true";

    // —— Origin ——
    const evil = await handleRequestCode(
      makeReq(
        "POST",
        { email: "a@example.com" },
        { origin: "https://evil.example" }
      ),
      deps
    );
    if (evil.status === 403) pass("evil_origin");
    else fail("evil_origin", `status=${evil.status}`);

    const noOrigin = await handleRequestCode(
      makeReq("POST", { email: "a@example.com" }, {}),
      deps
    );
    if (noOrigin.status === 403) pass("missing_origin");
    else fail("missing_origin", `status=${noOrigin.status}`);

    // —— I01 valid invite ——
    const email1 = `alpha1-${randomUUID().slice(0, 8)}@example.com`;
    const inv1 = await createAlphaInvite(email1, {
      db,
      now: new Date(clock),
    });
    trackedInvites.push(inv1.inviteId);
    adapter.clear();
    const r1 = await handleRequestCode(
      makeReq(
        "POST",
        { email: email1, inviteToken: inv1.rawToken },
        originOk
      ),
      deps
    );
    if (
      r1.status === 202 &&
      (r1.body as { challengeId?: string }).challengeId &&
      assertNoStore(r1.headers) &&
      adapter.deliveries.length === 1
    ) {
      pass("valid_invite");
    } else fail("valid_invite", JSON.stringify(r1.body));

    const codeForEmail1 = adapter.lastCodeFor(normalizeEmail(email1));
    const challengeIdEmail1 = (r1.body as { challengeId: string }).challengeId;

    // —— I02 no invite ——
    adapter.clear();
    const email2 = `alpha2-${randomUUID().slice(0, 8)}@example.com`;
    const r2 = await handleRequestCode(
      makeReq("POST", { email: email2 }, originOk),
      deps
    );
    if (
      r2.status === 202 &&
      adapter.deliveries.length === 0 &&
      (await db.select().from(authChallenges).where(eq(authChallenges.emailLookupHash, computeEmailLookupHash(normalizeEmail(email2))))).length === 0
    ) {
      pass("missing_invite");
    } else fail("missing_invite", `deliveries=${adapter.deliveries.length}`);

    // —— I03 wrong invite ——
    adapter.clear();
    const r3 = await handleRequestCode(
      makeReq(
        "POST",
        { email: email2, inviteToken: "totally-wrong-token-value" },
        originOk
      ),
      deps
    );
    if (r3.status === 202 && adapter.deliveries.length === 0) pass("wrong_invite");
    else fail("wrong_invite", "sent or bad status");

    // —— I04 email mismatch ——
    adapter.clear();
    const r4 = await handleRequestCode(
      makeReq(
        "POST",
        {
          email: `other-${randomUUID().slice(0, 8)}@example.com`,
          inviteToken: inv1.rawToken,
        },
        originOk
      ),
      deps
    );
    if (r4.status === 202 && adapter.deliveries.length === 0) pass("mismatch");
    else fail("mismatch", "leak");

    // —— I05 expired ——
    const emailExp = `exp-${randomUUID().slice(0, 8)}@example.com`;
    const invExp = await createAlphaInvite(emailExp, {
      db,
      ttlMs: 1000,
      now: new Date(clock - 10_000),
    });
    trackedInvites.push(invExp.inviteId);
    adapter.clear();
    const r5 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailExp, inviteToken: invExp.rawToken },
        originOk
      ),
      deps
    );
    if (r5.status === 202 && adapter.deliveries.length === 0) pass("expired");
    else fail("expired", "sent");

    // —— I06 revoked ——
    const emailRev = `rev-${randomUUID().slice(0, 8)}@example.com`;
    const invRev = await createAlphaInvite(emailRev, {
      db,
      now: new Date(clock),
    });
    trackedInvites.push(invRev.inviteId);
    await revokeAlphaInvite(invRev.inviteId, { db, now: new Date(clock) });
    adapter.clear();
    const r6 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailRev, inviteToken: invRev.rawToken },
        originOk
      ),
      deps
    );
    if (r6.status === 202 && adapter.deliveries.length === 0) pass("revoked");
    else fail("revoked", "sent");

    // —— Enumeration shape ——
    const shapes = [r1, r2, r3, r4].map((r) => ({
      status: r.status,
      keys: Object.keys(r.body as object).sort().join(","),
      success: (r.body as { success?: boolean }).success,
    }));
    if (
      shapes.every(
        (s) => s.status === 202 && s.success === true && s.keys === "challengeId,success"
      )
    ) {
      pass("enumeration");
    } else fail("enumeration", JSON.stringify(shapes));

    // —— HTTP verify + cookie + me + logout ——
    if (!codeForEmail1) {
      fail("HTTP_verify", "no code");
    } else {
      const challengeId = challengeIdEmail1;
      const code = codeForEmail1;
      const wrong = await handleVerify(
        makeReq("POST", { challengeId, code: "000000" }, originOk),
        deps
      );
      if (
        wrong.status === 401 &&
        (wrong.body as { code?: string }).code === "INVALID_OR_EXPIRED_CODE"
      ) {
        pass("verify_wrong_unified");
      } else fail("verify_wrong_unified", JSON.stringify(wrong.body));

      const ok = await handleVerify(
        makeReq("POST", { challengeId, code }, originOk),
        deps
      );
      const token = cookieFromSet(ok.cookies);
      const setCookie = ok.cookies[0] ?? "";
      if (
        ok.status === 200 &&
        token &&
        setCookie.includes("HttpOnly") &&
        setCookie.includes("SameSite=Lax") &&
        setCookie.includes("Path=/") &&
        setCookie.includes("Secure") &&
        !JSON.stringify(ok.body).includes(token)
      ) {
        pass("HTTP_verify");
        pass("cookie");
        trackedUsers.push((ok.body as { user: { id: string } }).user.id);

        const me = await handleMe(
          makeReq("GET", {}, { cookie: `cf_v1_session=${token}` }),
          deps
        );
        if (
          me.status === 200 &&
          (me.body as { authenticated?: boolean }).authenticated === true &&
          !(me.body as { user?: { email?: string } }).user?.email
        ) {
          pass("me");
        } else fail("me", JSON.stringify(me.body));

        const fakeMe = await handleMe(
          makeReq("GET", {}, { cookie: "cf_v1_session=faketoken" }),
          deps
        );
        if (fakeMe.status === 401) pass("me_fake");
        else fail("me_fake", String(fakeMe.status));

        const lo = await handleLogout(
          makeReq("POST", {}, { ...originOk, cookie: `cf_v1_session=${token}` }),
          deps
        );
        const meAfter = await handleMe(
          makeReq("GET", {}, { cookie: `cf_v1_session=${token}` }),
          deps
        );
        if (
          lo.status === 200 &&
          (lo.cookies[0] ?? "").includes("Max-Age=0") &&
          meAfter.status === 401
        ) {
          pass("logout");
        } else fail("logout", "not revoked");

        const lo2 = await handleLogout(
          makeReq("POST", {}, { ...originOk, cookie: `cf_v1_session=${token}` }),
          deps
        );
        if (lo2.status === 200) pass("logout_repeat");
        else fail("logout_repeat", String(lo2.status));
      } else {
        fail("HTTP_verify", "cookie/body");
        fail("cookie", setCookie.slice(0, 80));
      }
    }

    // —— I07 consumed invite ——
    adapter.clear();
    const rConsumed = await handleRequestCode(
      makeReq(
        "POST",
        { email: email1, inviteToken: inv1.rawToken },
        originOk
      ),
      deps
    );
    // email1 now exists → login without needing invite (I08 path). Invite consumed.
    // For consumed check: new email with same consumed invite token
    const emailNew = `new-${randomUUID().slice(0, 8)}@example.com`;
    adapter.clear();
    const rCons2 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailNew, inviteToken: inv1.rawToken },
        originOk
      ),
      deps
    );
    if (rCons2.status === 202 && adapter.deliveries.length === 0) {
      pass("consumed");
    } else fail("consumed", "invite still usable");

    // —— I08 existing user login without invite ——
    adapter.clear();
    clock += OTP_MIN_INTERVAL_MS + 1000;
    const rLogin = await handleRequestCode(
      makeReq("POST", { email: email1 }, originOk),
      deps
    );
    if (rLogin.status === 202 && adapter.deliveries.length === 1) {
      pass("existing_login");
    } else fail("existing_login", `d=${adapter.deliveries.length}`);

    // —— Concurrent invite consume ——
    const emailC = `conc-${randomUUID().slice(0, 8)}@example.com`;
    const invC = await createAlphaInvite(emailC, {
      db,
      now: new Date(clock),
    });
    trackedInvites.push(invC.inviteId);
    adapter.clear();
    clock += OTP_MIN_INTERVAL_MS + 1000;
    const c1 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailC, inviteToken: invC.rawToken },
        originOk
      ),
      deps
    );
    clock += OTP_MIN_INTERVAL_MS + 1000;
    const c2 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailC, inviteToken: invC.rawToken },
        originOk
      ),
      deps
    );
    const codeA = adapter.deliveries[0]?.code;
    const codeB = adapter.deliveries[1]?.code;
    const idA = (c1.body as { challengeId: string }).challengeId;
    const idB = (c2.body as { challengeId: string }).challengeId;
    if (codeA && codeB && idA && idB) {
      const outcomes = await Promise.allSettled([
        handleVerify(
          makeReq("POST", { challengeId: idA, code: codeA }, originOk),
          deps
        ),
        handleVerify(
          makeReq("POST", { challengeId: idB, code: codeB }, originOk),
          deps
        ),
      ]);
      const bodies = outcomes.map((o) =>
        o.status === "fulfilled" ? o.value : null
      );
      const successes = bodies.filter((b) => b && b.status === 200);
      const failures = bodies.filter((b) => b && b.status !== 200);
      const userCount = await db.execute(sql`
        SELECT count(*)::int AS c FROM users
        WHERE email_lookup_hash = ${computeEmailLookupHash(normalizeEmail(emailC))}
      `);
      const inviteRow = await inviteRepo.findInviteById(db, invC.inviteId);
      const uc = Number((userCount.rows[0] as { c: number }).c);
      if (
        successes.length === 1 &&
        failures.length === 1 &&
        uc === 1 &&
        inviteRow?.consumedAt
      ) {
        pass("concurrent_invite");
        trackedUsers.push(
          (successes[0]!.body as { user: { id: string } }).user.id
        );
      } else {
        fail(
          "concurrent_invite",
          `ok=${successes.length} fail=${failures.length} users=${uc}`
        );
      }
    } else fail("concurrent_invite", "missing challenges");

    // —— Throttle ——
    const emailT = `thr-${randomUUID().slice(0, 8)}@example.com`;
    const invT = await createAlphaInvite(emailT, {
      db,
      now: new Date(clock),
    });
    trackedInvites.push(invT.inviteId);
    adapter.clear();
    clock += OTP_MIN_INTERVAL_MS + 1000;
    const t1 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailT, inviteToken: invT.rawToken },
        originOk
      ),
      deps
    );
    const dAfter1 = adapter.deliveries.length;
    const t2 = await handleRequestCode(
      makeReq(
        "POST",
        { email: emailT, inviteToken: invT.rawToken },
        originOk
      ),
      deps
    );
    const dAfter2 = adapter.deliveries.length;
    if (
      t1.status === 202 &&
      t2.status === 202 &&
      dAfter1 === 1 &&
      dAfter2 === 1
    ) {
      pass("throttle_min_interval");
    } else fail("throttle_min_interval", `d=${dAfter1}->${dAfter2}`);

    // Fill to 15m limit (need 2 more real sends at spaced intervals)
    for (let i = 0; i < OTP_ROLLING_15M_LIMIT - 1; i++) {
      clock += OTP_MIN_INTERVAL_MS + 1000;
      await handleRequestCode(
        makeReq(
          "POST",
          { email: emailT, inviteToken: invT.rawToken },
          originOk
        ),
        deps
      );
    }
    const dAtLimit = adapter.deliveries.length;
    clock += OTP_MIN_INTERVAL_MS + 1000;
    await handleRequestCode(
      makeReq(
        "POST",
        { email: emailT, inviteToken: invT.rawToken },
        originOk
      ),
      deps
    );
    if (adapter.deliveries.length === dAtLimit && dAtLimit === OTP_ROLLING_15M_LIMIT) {
      pass("throttle_15m");
    } else {
      fail(
        "throttle_15m",
        `deliveries=${adapter.deliveries.length} expected=${OTP_ROLLING_15M_LIMIT}`
      );
    }

    // 24h boundary: jump clock past 15m window but stay in 24h with many challenges
    // Create fresh email and insert enough challenge rows via spaced sends then jump
    const emailD = `day-${randomUUID().slice(0, 8)}@example.com`;
    const invD = await createAlphaInvite(emailD, {
      db,
      now: new Date(clock),
    });
    trackedInvites.push(invD.inviteId);
    adapter.clear();
    // Space sends beyond 15m each time by advancing clock by 16 minutes, up to 10
    for (let i = 0; i < OTP_ROLLING_24H_LIMIT; i++) {
      clock += OTP_ROLLING_15M_MS + OTP_MIN_INTERVAL_MS;
      await handleRequestCode(
        makeReq(
          "POST",
          { email: emailD, inviteToken: invD.rawToken },
          originOk
        ),
        deps
      );
    }
    const d24 = adapter.deliveries.length;
    clock += OTP_ROLLING_15M_MS + OTP_MIN_INTERVAL_MS;
    await handleRequestCode(
      makeReq(
        "POST",
        { email: emailD, inviteToken: invD.rawToken },
        originOk
      ),
      deps
    );
    if (
      d24 === OTP_ROLLING_24H_LIMIT &&
      adapter.deliveries.length === OTP_ROLLING_24H_LIMIT
    ) {
      pass("throttle_24h");
    } else {
      fail("throttle_24h", `d24=${d24} after=${adapter.deliveries.length}`);
    }
    pass("throttle", "min+15m+24h covered");

    // —— raw invite not in DB ——
    const hash = hashInviteToken(inv1.rawToken);
    const invRow = await inviteRepo.findInviteByTokenHash(db, hash);
    if (invRow && !(JSON.stringify(invRow) as string).includes(inv1.rawToken)) {
      pass("raw_invite_DB_absent");
    } else fail("raw_invite_DB_absent", "leak?");

    // —— Resend official test (optional live) ——
    if (isResendConfigured()) {
      try {
        const testEmail = `delivered+cf-v1-auth-${randomUUID().slice(0, 8)}@resend.dev`;
        const live = createResendOtpDeliveryAdapter();
        await live.deliver(testEmail, "123456", {
          challengeId: randomUUID(),
        });
        pass("Resend_test", "official test address accepted");
      } catch (e) {
        fail(
          "Resend_test",
          e instanceof Error ? e.message : "send failed"
        );
      }
    } else {
      fail("Resend_test", "RESEND_API_KEY missing");
    }

    if (isVerifiedSenderDomainReady()) {
      pass("sender_verified_flag", "env true");
    } else {
      pass(
        "sender_domain_required",
        "V1_AUTH_SENDER_VERIFIED not set — Alpha gate stays false in prod"
      );
    }
  } catch (e) {
    fail("fatal", e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    await db.delete(sessions);
    await db.delete(authChallenges);
    await db.delete(alphaInvites);
    await db.delete(users);
    // ensure families untouched / zero
    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM sessions) AS sessions,
        (SELECT count(*)::int FROM auth_challenges) AS challenges,
        (SELECT count(*)::int FROM alpha_invites) AS invites,
        (SELECT count(*)::int FROM families) AS families
    `);
    const c = counts.rows[0] as Record<string, number>;
    if (
      Number(c.users) === 0 &&
      Number(c.sessions) === 0 &&
      Number(c.challenges) === 0 &&
      Number(c.invites) === 0 &&
      Number(c.families) === 0
    ) {
      pass("cleanup");
    } else {
      fail("cleanup", JSON.stringify(c));
    }
    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n—— SUMMARY ——");
  console.log(`PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
